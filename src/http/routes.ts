import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Platform, TenantContext } from '../app.ts';
import type { RealtimeScope } from '../data/store.ts';
import { STATUS_LABELS } from '../domain/applications.ts';
import { APPLICATION_STATUSES, JOB_CATEGORIES } from '../domain/types.ts';
import type {
  Actor,
  ApplicationStatus,
  Currency,
  EducationLevel,
  JobCategory,
  SalaryPeriod,
  SwipeDirection,
} from '../domain/types.ts';
import { AppError } from '../services/errors.ts';
import { AGENCY_SCOPE_ID } from '../services/events.ts';
import { HANDLED, Router, html, json, type Ctx } from './router.ts';

const CURRENCIES: readonly Currency[] = ['TZS', 'USD', 'KES', 'EUR'];
const SALARY_PERIODS: readonly SalaryPeriod[] = ['hour', 'day', 'week', 'month', 'year'];

// ------------------------------------------------------------------ helpers

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw AppError.badRequest('missing_field', `"${key}" is required.`);
  }
  return value.trim();
}

function optStr(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function optNum(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw AppError.badRequest('invalid_field', `"${key}" must be a number.`);
  return parsed;
}

function optBool(body: Record<string, unknown>, key: string): boolean | null {
  const value = body[key];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  throw AppError.badRequest('invalid_field', `"${key}" must be true or false.`);
}

function strArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
  if (!Array.isArray(value)) throw AppError.badRequest('invalid_field', `"${key}" must be a list.`);
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function bearer(ctx: Ctx): string | null {
  const header = ctx.req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  // EventSource cannot set headers, so the live streams accept a query token.
  return ctx.query.get('token');
}

function readPage(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../web/${name}`, import.meta.url)), 'utf8');
}

function statusFrom(value: unknown): ApplicationStatus {
  if (typeof value !== 'string' || !APPLICATION_STATUSES.includes(value as ApplicationStatus)) {
    throw AppError.badRequest('invalid_status', `"status" must be one of ${APPLICATION_STATUSES.join(', ')}.`);
  }
  return value as ApplicationStatus;
}

export function createRouter(platform: Platform): Router {
  const router = new Router();

  /** Agency console: the tenant's API key both authenticates and selects the tenant. */
  const requireAgency = (ctx: Ctx): { context: TenantContext; actor: Actor } => {
    const supplied =
      (typeof ctx.req.headers['x-agency-key'] === 'string' ? ctx.req.headers['x-agency-key'] : null) ??
      ctx.query.get('key');
    const context = platform.tenantForApiKey(supplied);
    if (context === null) throw AppError.unauthorised('Agency staff key required.');
    const staffId = optStr(ctx.body, 'staffId') ?? ctx.query.get('staffId') ?? 'agency-staff';
    return { context, actor: { kind: 'agency', id: staffId } };
  };

  const requireEmployer = (ctx: Ctx): { context: TenantContext; employerId: string } => {
    const session = platform.sessionContext(bearer(ctx));
    if (session === null || session.subject.kind !== 'employer') throw AppError.unauthorised();
    session.context.store.markEmployerSeen(session.subject.id);
    return { context: session.context, employerId: session.subject.id };
  };

  const requireApplicant = (ctx: Ctx): { context: TenantContext; applicantId: string } => {
    const session = platform.sessionContext(bearer(ctx));
    if (session === null || session.subject.kind !== 'applicant') throw AppError.unauthorised();
    const pathId = ctx.params.id;
    if (pathId !== undefined && pathId !== session.subject.id) {
      throw AppError.forbidden('You can only work with your own profile.');
    }
    return { context: session.context, applicantId: session.subject.id };
  };

  /** Server-sent events with replay, used by all three live views. */
  const stream = (ctx: Ctx, context: TenantContext, scope: RealtimeScope, scopeId: string): typeof HANDLED => {
    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const lastEventId = ctx.req.headers['last-event-id'];
    const since = Number((typeof lastEventId === 'string' ? lastEventId : null) ?? ctx.query.get('since') ?? '0');
    const write = (event: { id: number; type: string; payload: unknown }): void => {
      ctx.res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    };

    for (const event of context.bus.replay(scope, scopeId, Number.isFinite(since) ? since : 0)) write(event);
    ctx.res.write(': connected\n\n');

    const unsubscribe = context.bus.subscribe(scope, scopeId, write);
    const heartbeat = setInterval(() => ctx.res.write(': ping\n\n'), 25_000);
    ctx.req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      ctx.res.end();
    });
    return HANDLED;
  };

  // ------------------------------------------------------------------ pages

  router.get('/', (ctx) => html(ctx.res, 200, readPage('index.html')));
  router.get('/jobs', (ctx) => html(ctx.res, 200, readPage('swipe.html')));
  router.get('/admin', (ctx) => html(ctx.res, 200, readPage('agency.html')));
  router.get('/e/:code', (ctx) => html(ctx.res, 200, readPage('employer.html')));
  router.get('/health', () => ({ ok: true, service: 'kobeos' }));

  router.get('/uploads/:name', (ctx) => {
    const file = platform.uploads.read(`/uploads/${ctx.params.name ?? ''}`);
    ctx.res.writeHead(200, { 'content-type': file.contentType, 'cache-control': 'public, max-age=86400' });
    ctx.res.end(file.body);
    return HANDLED;
  });

  // -------------------------------------------------------------- reference

  router.get('/api/plans', () => {
    const context = platform.tenantContext(platform.defaultTenant.id);
    return { tenant: context.tenant.name, plans: context.memberships.plans() };
  });

  router.get('/api/jobs/:jobId', (ctx) => {
    const context = platform.tenantContext(platform.defaultTenant.id);
    return context.swipe.jobDetail(ctx.params.jobId ?? '');
  });

  // ------------------------------------------------------- applicant access

  /** Applicants register with the agency, so registration issues the app token. */
  router.post('/api/applicants/register', (ctx) => {
    const context = platform.tenantContext(platform.defaultTenant.id);
    const profile = context.applicants.register({
      fullName: str(ctx.body, 'fullName'),
      phone: str(ctx.body, 'phone'),
      email: optStr(ctx.body, 'email'),
      location: str(ctx.body, 'location'),
      educationLevel: (optStr(ctx.body, 'educationLevel') ?? 'none') as EducationLevel,
      experienceYears: optNum(ctx.body, 'experienceYears') ?? 0,
      skills: strArray(ctx.body, 'skills'),
      languages: strArray(ctx.body, 'languages'),
      willingToRelocate: optBool(ctx.body, 'willingToRelocate') ?? false,
      photoPath: optStr(ctx.body, 'photoPath'),
      categories: strArray(ctx.body, 'categories') as JobCategory[],
      preferredLocations: strArray(ctx.body, 'preferredLocations'),
      minSalaryTzs: optNum(ctx.body, 'minSalaryTzs'),
      certificateRequired: optBool(ctx.body, 'certificateRequired'),
    });
    const session = context.access.startApplicantSession(profile.applicant.id);
    return { ...profile, session };
  });

  router.post('/api/applicants/login', (ctx) => {
    const context = platform.tenantContext(platform.defaultTenant.id);
    const applicant = context.store.getApplicantByPhone(str(ctx.body, 'phone'));
    if (applicant === null) throw AppError.unauthorised('No account with that phone number.');
    return { session: context.access.startApplicantSession(applicant.id), applicantId: applicant.id };
  });

  router.get('/api/applicants/:id', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    return {
      ...context.applicants.profile(applicantId),
      membership: context.memberships.view(applicantId),
    };
  });

  router.patch('/api/applicants/:id', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    return context.applicants.updateProfile(applicantId, {
      fullName: optStr(ctx.body, 'fullName') ?? undefined,
      email: optStr(ctx.body, 'email'),
      location: optStr(ctx.body, 'location') ?? undefined,
      educationLevel: (optStr(ctx.body, 'educationLevel') ?? undefined) as EducationLevel | undefined,
      experienceYears: optNum(ctx.body, 'experienceYears') ?? undefined,
      skills: ctx.body.skills === undefined ? undefined : strArray(ctx.body, 'skills'),
      languages: ctx.body.languages === undefined ? undefined : strArray(ctx.body, 'languages'),
      willingToRelocate: optBool(ctx.body, 'willingToRelocate') ?? undefined,
      photoPath: optStr(ctx.body, 'photoPath'),
    });
  });

  router.put('/api/applicants/:id/preferences', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    return context.applicants.savePreferences(applicantId, {
      categories: strArray(ctx.body, 'categories') as JobCategory[],
      locations: strArray(ctx.body, 'locations'),
      minSalaryTzs: optNum(ctx.body, 'minSalaryTzs'),
      certificateRequired: optBool(ctx.body, 'certificateRequired'),
    });
  });

  router.get('/api/applicants/:id/cv', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    return { cv: context.applicants.cv(applicantId), text: context.applicants.cvText(applicantId) };
  });

  router.post('/api/applicants/:id/certificates', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    const stored = platform.uploads.save(str(ctx.body, 'filename'), str(ctx.body, 'fileBase64'));
    return context.applicants.addCertificate(applicantId, {
      label: optStr(ctx.body, 'label') ?? 'Certificate',
      filePath: stored.path,
    });
  });

  router.post('/api/applicants/:id/photo', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    const stored = platform.uploads.save(str(ctx.body, 'filename'), str(ctx.body, 'fileBase64'));
    return context.applicants.updateProfile(applicantId, { photoPath: stored.path });
  });

  // ------------------------------------------------------ membership & pay

  router.post('/api/applicants/:id/payments', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    return context.memberships.submitPayment({
      applicantId,
      planCode: str(ctx.body, 'planCode'),
      amountTzs: optNum(ctx.body, 'amountTzs') ?? 0,
      reference: str(ctx.body, 'reference'),
      method: optStr(ctx.body, 'method') ?? 'mobile_money',
    });
  });

  router.get('/api/applicants/:id/membership', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    return context.memberships.view(applicantId);
  });

  // ------------------------------------------------------------------ feed

  router.get('/api/applicants/:id/feed', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    const limit = Number(ctx.query.get('limit') ?? 20);
    return { cards: context.swipe.feed(applicantId, Number.isFinite(limit) ? limit : 20) };
  });

  router.get('/api/applicants/:id/jobs/:jobId', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    return context.swipe.jobDetail(ctx.params.jobId ?? '', applicantId);
  });

  router.post('/api/applicants/:id/swipes', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    const direction = str(ctx.body, 'direction');
    if (direction !== 'left' && direction !== 'right' && direction !== 'up') {
      throw AppError.badRequest('invalid_direction', '"direction" must be left, right or up.');
    }
    return context.swipe.swipe(
      applicantId,
      str(ctx.body, 'jobId'),
      direction as SwipeDirection,
      optBool(ctx.body, 'confirmed') ?? false,
    );
  });

  router.get('/api/applicants/:id/saved', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    return { cards: context.swipe.savedJobs(applicantId) };
  });

  router.get('/api/applicants/:id/applications', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    return { applications: context.swipe.tracker(applicantId) };
  });

  router.get('/api/applicants/:id/applications/:applicationId/package', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    return context.swipe.applicationPackage(applicantId, ctx.params.applicationId ?? '');
  });

  router.get('/api/applicants/:id/stream', (ctx) => {
    const { context, applicantId } = requireApplicant(ctx);
    return stream(ctx, context, 'applicant', applicantId);
  });

  // --------------------------------------------------------------- employer

  /** Public: what the /e/<code> page shows before the client signs in. */
  router.get('/api/e/:code', (ctx) => {
    const employer = platform.store.findEmployerByAccessCode(ctx.params.code ?? '');
    if (employer === null) throw AppError.notFound('That link is not valid.');
    const context = platform.tenantContext(employer.tenantId);
    return {
      name: employer.name,
      agency: context.tenant.name,
      hasEmail: employer.contactEmail !== null,
      hasPhone: employer.contactPhone !== null,
    };
  });

  router.post('/api/e/:code/otp', (ctx) => {
    const employer = platform.store.findEmployerByAccessCode(ctx.params.code ?? '');
    if (employer === null) throw AppError.notFound('That link is not valid.');
    const context = platform.tenantContext(employer.tenantId);
    const channel = optStr(ctx.body, 'channel') ?? 'phone';
    const kind = channel === 'email' ? 'email_otp' : 'phone_otp';
    const issued = context.access.issueOtp(employer, kind);

    // No SMS gateway in the MVP: the code lands on the agency console and
    // staff pass it on. The response never carries the code itself.
    context.bus.publish('agency', AGENCY_SCOPE_ID, 'employer_otp_requested', {
      employerId: employer.id,
      employerName: employer.name,
      kind,
      destination: issued.destination,
      code: issued.secret,
      expiresAt: issued.expiresAt,
    });
    const destination = issued.destination ?? '';
    return {
      sent: true,
      kind,
      maskedDestination: destination.replace(/.(?=.{3})/g, '*'),
      note: 'The agency will pass the code to you.',
    };
  });

  router.post('/api/e/:code/login', (ctx) => {
    const employer = platform.store.findEmployerByAccessCode(ctx.params.code ?? '');
    if (employer === null) {
      // Same message either way, so the link cannot be used to probe for clients.
      throw AppError.unauthorised('That code is not valid. Ask the agency to send you a new one.');
    }
    const context = platform.tenantContext(employer.tenantId);
    const kindValue = optStr(ctx.body, 'kind') ?? 'access_code';
    if (kindValue !== 'access_code' && kindValue !== 'email_otp' && kindValue !== 'phone_otp') {
      throw AppError.badRequest('invalid_kind', 'Unknown access type.');
    }
    const session = context.access.authenticateEmployer(employer, kindValue, str(ctx.body, 'secret'));
    return { ...session, employer: { id: employer.id, name: employer.name } };
  });

  router.post('/api/employer/logout', (ctx) => {
    const token = bearer(ctx);
    if (token !== null) platform.sessionContext(token)?.context.access.logout(token);
    return { ok: true };
  });

  router.get('/api/employer/dashboard', (ctx) => {
    const { context, employerId } = requireEmployer(ctx);
    return context.employer.dashboard(employerId);
  });

  router.get('/api/employer/candidates', (ctx) => {
    const { context, employerId } = requireEmployer(ctx);
    const statusParam = ctx.query.get('status');
    return {
      candidates: context.employer.candidates(employerId, {
        jobId: ctx.query.get('jobId') ?? undefined,
        status: statusParam === null ? undefined : statusFrom(statusParam),
        location: ctx.query.get('location') ?? undefined,
        search: ctx.query.get('search') ?? undefined,
        limit: ctx.query.has('limit') ? Number(ctx.query.get('limit')) : undefined,
      }),
    };
  });

  router.get('/api/employer/candidates/:applicationId', (ctx) => {
    const { context, employerId } = requireEmployer(ctx);
    return context.employer.openCandidate(employerId, ctx.params.applicationId ?? '', {
      kind: 'employer',
      id: employerId,
    });
  });

  router.post('/api/employer/candidates/:applicationId/status', (ctx) => {
    const { context, employerId } = requireEmployer(ctx);
    return context.employer.transition(
      employerId,
      ctx.params.applicationId ?? '',
      statusFrom(ctx.body.status),
      { kind: 'employer', id: employerId },
      optStr(ctx.body, 'note'),
    );
  });

  router.post('/api/employer/candidates/:applicationId/notes', (ctx) => {
    const { context, employerId } = requireEmployer(ctx);
    return context.employer.addNote(employerId, ctx.params.applicationId ?? '', str(ctx.body, 'note'));
  });

  /**
   * A client typing a vacancy themselves, rather than sending it to the
   * agency. It joins the same review queue and only goes live when staff
   * publish it.
   */
  router.post('/api/employer/jobs', (ctx) => {
    const { context, employerId } = requireEmployer(ctx);
    const category = optStr(ctx.body, 'category') ?? 'other';
    if (!JOB_CATEGORIES.includes(category as JobCategory)) {
      throw AppError.badRequest('invalid_category', `"category" must be one of ${JOB_CATEGORIES.join(', ')}.`);
    }
    const positions = optNum(ctx.body, 'positions') ?? 1;
    if (positions < 1 || positions > 500) {
      throw AppError.badRequest('invalid_positions', 'Enter between 1 and 500 positions.');
    }
    const currency = optStr(ctx.body, 'salaryCurrency') ?? 'TZS';
    if (!CURRENCIES.includes(currency as Currency)) {
      throw AppError.badRequest('invalid_currency', `"salaryCurrency" must be one of ${CURRENCIES.join(', ')}.`);
    }
    const period = optStr(ctx.body, 'salaryPeriod') ?? 'month';
    if (!SALARY_PERIODS.includes(period as SalaryPeriod)) {
      throw AppError.badRequest('invalid_period', `"salaryPeriod" must be one of ${SALARY_PERIODS.join(', ')}.`);
    }

    const draft = context.intake.submitFromEmployer({
      employerId,
      title: str(ctx.body, 'title'),
      location: str(ctx.body, 'location'),
      category: category as JobCategory,
      positions,
      salaryAmountMin: optNum(ctx.body, 'salaryAmountMin'),
      salaryAmountMax: optNum(ctx.body, 'salaryAmountMax'),
      salaryCurrency: currency as Currency,
      salaryPeriod: period as SalaryPeriod,
      salaryPlusTips: optBool(ctx.body, 'salaryPlusTips') ?? false,
      description: optStr(ctx.body, 'description'),
      responsibilities: strArray(ctx.body, 'responsibilities'),
      requirements: strArray(ctx.body, 'requirements'),
      applicationDeadline: optStr(ctx.body, 'applicationDeadline'),
      accommodationProvided: optBool(ctx.body, 'accommodationProvided') ?? false,
      languages: strArray(ctx.body, 'languages'),
      experienceNote: optStr(ctx.body, 'experienceNote'),
      certificateRequired: optBool(ctx.body, 'certificateRequired') ?? false,
      immediateStart: optBool(ctx.body, 'immediateStart') ?? false,
    });

    return {
      draftId: draft.id,
      status: draft.status,
      message: 'Sent to the agency. They will check it and publish it to applicants.',
    };
  });

  router.get('/api/employer/submissions', (ctx) => {
    const { context, employerId } = requireEmployer(ctx);
    return { submissions: context.employer.submissions(employerId) };
  });

  router.post('/api/employer/jobs/:jobId/close', (ctx) => {
    const { context, employerId } = requireEmployer(ctx);
    return context.employer.closeJob(employerId, ctx.params.jobId ?? '', { kind: 'employer', id: employerId });
  });

  router.get('/api/employer/stream', (ctx) => {
    const { context, employerId } = requireEmployer(ctx);
    return stream(ctx, context, 'employer', employerId);
  });

  // ----------------------------------------------------------------- agency

  router.post('/api/agency/uploads/image', (ctx) => {
    requireAgency(ctx);
    return platform.uploads.save(str(ctx.body, 'filename'), str(ctx.body, 'fileBase64'));
  });

  router.post('/api/agency/posts', async (ctx) => {
    const { context, actor } = requireAgency(ctx);
    const channel = (optStr(ctx.body, 'channel') ?? 'pasted_text') as 'pasted_text';
    const { draft } = await context.intake.uploadPost({
      channel,
      text: str(ctx.body, 'text'),
      imagePath: optStr(ctx.body, 'imagePath'),
      employerId: optStr(ctx.body, 'employerId'),
      employerName: optStr(ctx.body, 'employerName'),
      staffId: actor.id,
    });
    return { draft, extraction: draft.extraction };
  });

  router.get('/api/agency/queue', (ctx) => {
    const { context } = requireAgency(ctx);
    return { queue: context.agency.reviewQueue() };
  });

  router.get('/api/agency/drafts', (ctx) => {
    const { context } = requireAgency(ctx);
    const status = ctx.query.get('status');
    return { drafts: context.agency.drafts((status as 'extracted' | null) ?? undefined) };
  });

  router.get('/api/agency/drafts/:draftId', (ctx) => {
    const { context } = requireAgency(ctx);
    const draft = context.store.getDraft(ctx.params.draftId ?? '');
    if (draft === null) throw AppError.notFound('Draft not found.');
    return draft;
  });

  router.patch('/api/agency/drafts/:draftId', (ctx) => {
    const { context } = requireAgency(ctx);
    const corrections = ctx.body.corrections;
    if (typeof corrections !== 'object' || corrections === null) {
      throw AppError.badRequest('missing_field', '"corrections" must be an object of job fields.');
    }
    return context.intake.saveCorrections(
      ctx.params.draftId ?? '',
      corrections as Record<string, unknown>,
      optStr(ctx.body, 'employerId'),
    );
  });

  router.post('/api/agency/drafts/:draftId/publish', (ctx) => {
    const { context, actor } = requireAgency(ctx);
    return context.intake.publishDraft(ctx.params.draftId ?? '', {
      staffId: actor.id,
      employerId: optStr(ctx.body, 'employerId'),
      employerName: optStr(ctx.body, 'employerName'),
      contactName: optStr(ctx.body, 'contactName'),
      contactPhone: optStr(ctx.body, 'contactPhone'),
      contactEmail: optStr(ctx.body, 'contactEmail'),
    });
  });

  router.get('/api/agency/overview', (ctx) => {
    const { context } = requireAgency(ctx);
    return { summary: context.agency.summary(), rows: context.agency.overview() };
  });

  router.get('/api/agency/clients', (ctx) => {
    const { context } = requireAgency(ctx);
    return { clients: context.agency.clients() };
  });

  router.post('/api/agency/clients/:employerId/access', (ctx) => {
    const { context } = requireAgency(ctx);
    return context.agency.resendAccess(ctx.params.employerId ?? '');
  });

  router.get('/api/agency/applicants', (ctx) => {
    const { context } = requireAgency(ctx);
    return { applicants: context.agency.applicants() };
  });

  router.get('/api/agency/payments', (ctx) => {
    const { context } = requireAgency(ctx);
    return { payments: context.agency.pendingPayments() };
  });

  router.post('/api/agency/payments/:paymentId/confirm', (ctx) => {
    const { context, actor } = requireAgency(ctx);
    return context.memberships.confirmPayment(ctx.params.paymentId ?? '', actor.id);
  });

  router.post('/api/agency/payments/:paymentId/reject', (ctx) => {
    const { context, actor } = requireAgency(ctx);
    return context.memberships.rejectPayment(ctx.params.paymentId ?? '', actor.id, str(ctx.body, 'note'));
  });

  router.get('/api/agency/plans', (ctx) => {
    const { context } = requireAgency(ctx);
    return { plans: context.memberships.allPlans() };
  });

  /** The agency admin editing package names and prices. */
  router.put('/api/agency/plans/:code', (ctx) => {
    const { context } = requireAgency(ctx);
    const code = ctx.params.code ?? '';
    const existing = context.store.getPlan(code);
    return context.memberships.savePlan({
      code,
      name: optStr(ctx.body, 'name') ?? existing?.name ?? code,
      priceTzs: optNum(ctx.body, 'priceTzs') ?? existing?.priceTzs ?? 0,
      durationDays: optNum(ctx.body, 'durationDays') ?? existing?.durationDays ?? 90,
      coversNonCertificateJobs:
        optBool(ctx.body, 'coversNonCertificateJobs') ?? existing?.coversNonCertificateJobs ?? true,
      coversCertificateJobs: optBool(ctx.body, 'coversCertificateJobs') ?? existing?.coversCertificateJobs ?? false,
      active: optBool(ctx.body, 'active') ?? existing?.active ?? true,
    });
  });

  /** Agency staff acting for a client: same rules, recorded as the agency. */
  router.post('/api/agency/applications/:applicationId/status', (ctx) => {
    const { context, actor } = requireAgency(ctx);
    const application = context.store.getApplication(ctx.params.applicationId ?? '');
    if (application === null) throw AppError.notFound('Application not found.');
    return context.employer.transition(
      application.employerId,
      application.id,
      statusFrom(ctx.body.status),
      actor,
      optStr(ctx.body, 'note'),
    );
  });

  router.get('/api/agency/applications/:applicationId', (ctx) => {
    const { context } = requireAgency(ctx);
    const application = context.store.getApplication(ctx.params.applicationId ?? '');
    if (application === null) throw AppError.notFound('Application not found.');
    return {
      application,
      statusLabel: STATUS_LABELS[application.status],
      applicant: context.store.getApplicant(application.applicantId),
      cv: context.store.getCv(application.cvId),
      job: context.store.getJob(application.jobId),
      history: context.store.listStatusHistory(application.id),
    };
  });

  router.get('/api/agency/stream', (ctx) => {
    const { context } = requireAgency(ctx);
    return stream(ctx, context, 'agency', AGENCY_SCOPE_ID);
  });

  return router;
}
