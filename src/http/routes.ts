import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Kobeos } from '../app.ts';
import type { RealtimeScope } from '../data/store.ts';
import { STATUS_LABELS } from '../domain/applications.ts';
import { buildJobCard } from '../domain/cards.ts';
import { scoreMatch } from '../domain/matching.ts';
import { formatSalaryLine } from '../domain/salary.ts';
import type {
  Actor,
  ApplicationStatus,
  EducationLevel,
  EmploymentType,
  JobCategory,
  SwipeDirection,
  WorkMode,
} from '../domain/types.ts';
import { APPLICATION_STATUSES } from '../domain/types.ts';
import { AGENCY_SCOPE_ID } from '../services/events.ts';
import { AppError } from '../services/errors.ts';
import { HANDLED, Router, html, json, type Ctx } from './router.ts';

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
  if (!Array.isArray(value)) throw AppError.badRequest('invalid_field', `"${key}" must be a list.`);
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function bearer(ctx: Ctx): string | null {
  const header = ctx.req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  // EventSource cannot set headers, so the live streams accept a query token.
  return ctx.query.get('token');
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
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

export function createRouter(app: Kobeos): Router {
  const router = new Router();

  const requireAgency = (ctx: Ctx): Actor => {
    const supplied =
      (typeof ctx.req.headers['x-agency-key'] === 'string' ? ctx.req.headers['x-agency-key'] : null) ??
      ctx.query.get('key');
    if (supplied === null || !safeEquals(supplied, app.config.agencyApiKey)) {
      throw AppError.unauthorised('Soko Huru staff key required.');
    }
    const staffId = optStr(ctx.body, 'staffId') ?? ctx.query.get('staffId') ?? 'soko-huru-staff';
    return { kind: 'agency', id: staffId };
  };

  const requireEmployer = (ctx: Ctx) => app.access.requireEmployer(bearer(ctx));

  const requireApplicant = (ctx: Ctx): string => {
    const applicantId = app.access.requireApplicantId(bearer(ctx));
    const pathId = ctx.params.id;
    if (pathId !== undefined && pathId !== applicantId) {
      throw AppError.forbidden('You can only work with your own applicant profile.');
    }
    return applicantId;
  };

  /** Server-sent events with replay, used by both live dashboards. */
  const stream = (ctx: Ctx, scope: RealtimeScope, scopeId: string): typeof HANDLED => {
    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const lastEventId = ctx.req.headers['last-event-id'];
    const since = Number(
      (typeof lastEventId === 'string' ? lastEventId : null) ?? ctx.query.get('since') ?? '0',
    );

    const write = (event: { id: number; type: string; payload: unknown }): void => {
      ctx.res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    };

    for (const event of app.bus.replay(scope, scopeId, Number.isFinite(since) ? since : 0)) write(event);
    ctx.res.write(': connected\n\n');

    const unsubscribe = app.bus.subscribe(scope, scopeId, write);
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
  router.get('/swipe', (ctx) => html(ctx.res, 200, readPage('swipe.html')));
  router.get('/agency', (ctx) => html(ctx.res, 200, readPage('agency.html')));
  router.get('/client/:slug', (ctx) => html(ctx.res, 200, readPage('employer.html')));
  router.get('/client/:slug/jobs/:jobSlug', (ctx) => html(ctx.res, 200, readPage('employer.html')));
  router.get('/health', () => ({ ok: true, service: 'kobeos' }));

  // -------------------------------------------------------------- reference

  router.get('/api/packages', () => ({ packages: app.memberships.packages() }));

  router.get('/api/vacancies/:id', (ctx) => {
    const vacancy = app.store.getVacancy(ctx.params.id ?? '');
    if (vacancy === null || vacancy.status === 'draft') throw AppError.notFound('Vacancy not found.');
    const employer = app.store.getEmployer(vacancy.employerId);
    const stats = app.store.vacancyStats(vacancy.id);
    return {
      vacancy,
      salaryLine: formatSalaryLine(vacancy.salary),
      employerName: employer?.name ?? null,
      remainingPositions: stats?.remainingPositions ?? vacancy.positions,
      postedThrough: 'Soko Huru',
    };
  });

  // ------------------------------------------------------------- applicants

  router.post('/api/applicants/:id/session', (ctx) => {
    requireAgency(ctx);
    return app.access.startApplicantSession(ctx.params.id ?? '');
  });

  router.get('/api/applicants/:id', (ctx) => {
    const applicantId = requireApplicant(ctx);
    const applicant = app.store.getApplicant(applicantId);
    if (applicant === null) throw AppError.notFound('Applicant not found.');
    return {
      applicant,
      cvs: app.store.listCvs(applicantId),
      preferences: app.store.getPreferences(applicantId),
      membership: app.memberships.view(applicantId),
    };
  });

  router.post('/api/applicants/:id/cvs', (ctx) => {
    const applicantId = requireApplicant(ctx);
    return app.store.addCv({
      applicantId,
      label: str(ctx.body, 'label'),
      categories: strArray(ctx.body, 'categories') as JobCategory[],
      headline: optStr(ctx.body, 'headline'),
      experienceYears: optNum(ctx.body, 'experienceYears') ?? 0,
      educationLevel: (optStr(ctx.body, 'educationLevel') ?? 'none') as EducationLevel,
      skills: strArray(ctx.body, 'skills'),
      languages: strArray(ctx.body, 'languages'),
      certificates: strArray(ctx.body, 'certificates'),
      preferredSalaryTzs: optNum(ctx.body, 'preferredSalaryTzs'),
      filePath: optStr(ctx.body, 'filePath'),
      isDefault: optBool(ctx.body, 'isDefault') ?? false,
    });
  });

  router.put('/api/applicants/:id/preferences', (ctx) => {
    const applicantId = requireApplicant(ctx);
    return app.store.savePreferences({
      applicantId,
      locations: strArray(ctx.body, 'locations'),
      categories: strArray(ctx.body, 'categories') as JobCategory[],
      minSalaryTzs: optNum(ctx.body, 'minSalaryTzs'),
      maxSalaryTzs: optNum(ctx.body, 'maxSalaryTzs'),
      certificateRequired: optBool(ctx.body, 'certificateRequired'),
      educationLevelMax: optStr(ctx.body, 'educationLevelMax') as EducationLevel | null,
      experienceYearsMax: optNum(ctx.body, 'experienceYearsMax'),
      accommodationRequiredOutsideHome: optBool(ctx.body, 'accommodationRequiredOutsideHome') ?? false,
      employmentTypes: strArray(ctx.body, 'employmentTypes') as EmploymentType[],
      workModes: strArray(ctx.body, 'workModes') as WorkMode[],
      willingToRelocate: optBool(ctx.body, 'willingToRelocate') ?? false,
      genderNeutralOnly: optBool(ctx.body, 'genderNeutralOnly') ?? false,
      immediateStartOnly: optBool(ctx.body, 'immediateStartOnly') ?? false,
    });
  });

  router.post('/api/applicants/:id/memberships', (ctx) => {
    const applicantId = requireApplicant(ctx);
    return app.memberships.purchase(applicantId, str(ctx.body, 'packageCode'));
  });

  router.get('/api/applicants/:id/membership', (ctx) => app.memberships.view(requireApplicant(ctx)));

  router.get('/api/applicants/:id/feed', (ctx) => {
    const applicantId = requireApplicant(ctx);
    const limit = Number(ctx.query.get('limit') ?? 20);
    return { cards: app.swipe.feed(applicantId, Number.isFinite(limit) ? limit : 20) };
  });

  router.post('/api/applicants/:id/swipes', (ctx) => {
    const applicantId = requireApplicant(ctx);
    const direction = str(ctx.body, 'direction');
    if (direction !== 'left' && direction !== 'right' && direction !== 'up') {
      throw AppError.badRequest('invalid_direction', '"direction" must be left, right or up.');
    }
    return app.swipe.swipe(applicantId, str(ctx.body, 'vacancyId'), direction as SwipeDirection);
  });

  router.get('/api/applicants/:id/saved', (ctx) => ({ cards: app.swipe.savedJobs(requireApplicant(ctx)) }));

  router.get('/api/applicants/:id/applications', (ctx) => ({
    applications: app.swipe.tracker(requireApplicant(ctx)),
  }));

  router.get('/api/applicants/:id/stream', (ctx) => stream(ctx, 'applicant', requireApplicant(ctx)));

  // ---------------------------------------------------------------- employer

  router.post('/api/employer/login', (ctx) => {
    const slug = str(ctx.body, 'slug');
    const employer = app.store.getEmployerBySlug(slug);
    const kindValue = optStr(ctx.body, 'kind') ?? 'one_time_code';
    if (kindValue !== 'password' && kindValue !== 'one_time_code' && kindValue !== 'email_otp' && kindValue !== 'phone_otp') {
      throw AppError.badRequest('invalid_kind', 'Unknown access type.');
    }
    if (employer === null) {
      // Same message either way so the portal cannot be used to probe for clients.
      throw AppError.unauthorised('That access code is not valid. Ask Soko Huru to resend your link.');
    }
    const session = app.access.authenticate(employer, kindValue, str(ctx.body, 'secret'));
    return { ...session, employer, portalUrl: app.store.getPortalUrl(employer.id) };
  });

  router.post('/api/employer/logout', (ctx) => {
    const token = bearer(ctx);
    if (token !== null) app.access.logout(token);
    return { ok: true };
  });

  router.get('/api/employer/dashboard', (ctx) => app.employer.dashboard(requireEmployer(ctx).id));

  router.get('/api/employer/applications', (ctx) => {
    const employer = requireEmployer(ctx);
    const statusParam = ctx.query.get('status');
    return {
      applications: app.employer.applications(employer.id, {
        vacancyId: ctx.query.get('vacancyId') ?? undefined,
        status: statusParam === null ? undefined : statusFrom(statusParam),
        location: ctx.query.get('location') ?? undefined,
        minExperienceYears: ctx.query.has('minExperienceYears')
          ? Number(ctx.query.get('minExperienceYears'))
          : undefined,
        education: (ctx.query.get('education') as EducationLevel | null) ?? undefined,
        language: ctx.query.get('language') ?? undefined,
        availableNow: ctx.query.get('availableNow') === 'true' ? true : undefined,
        search: ctx.query.get('search') ?? undefined,
        limit: ctx.query.has('limit') ? Number(ctx.query.get('limit')) : undefined,
        offset: ctx.query.has('offset') ? Number(ctx.query.get('offset')) : undefined,
      }),
    };
  });

  router.get('/api/employer/applications/:applicationId', (ctx) => {
    const employer = requireEmployer(ctx);
    return app.employer.openApplication(employer.id, ctx.params.applicationId ?? '', {
      kind: 'employer',
      id: employer.id,
    });
  });

  router.post('/api/employer/applications/:applicationId/status', (ctx) => {
    const employer = requireEmployer(ctx);
    const status = statusFrom(ctx.body.status);
    const actor: Actor = { kind: 'employer', id: employer.id };
    const applicationId = ctx.params.applicationId ?? '';
    const note = optStr(ctx.body, 'note');
    if (status === 'interview_invited') {
      return app.employer.inviteToInterview(employer.id, applicationId, optStr(ctx.body, 'interviewAt'), actor, note);
    }
    return app.employer.transition(employer.id, applicationId, status, actor, note);
  });

  router.post('/api/employer/applications/:applicationId/notes', (ctx) => {
    const employer = requireEmployer(ctx);
    return app.employer.addNote(employer.id, ctx.params.applicationId ?? '', str(ctx.body, 'note'));
  });

  router.post('/api/employer/vacancies/:vacancyId/close', (ctx) => {
    const employer = requireEmployer(ctx);
    return app.employer.closeVacancy(employer.id, ctx.params.vacancyId ?? '', { kind: 'employer', id: employer.id });
  });

  router.post('/api/employer/vacancies/:vacancyId/request-more', (ctx) => {
    const employer = requireEmployer(ctx);
    app.employer.requestMoreCandidates(employer.id, ctx.params.vacancyId ?? '', optStr(ctx.body, 'message'));
    return { ok: true };
  });

  router.get('/api/employer/stream', (ctx) => stream(ctx, 'employer', requireEmployer(ctx).id));

  /** Public lookup so the portal page can show the client's name before sign-in. */
  router.get('/api/client/:slug', (ctx) => {
    const employer = app.store.getEmployerBySlug(ctx.params.slug ?? '');
    if (employer === null) throw AppError.notFound('Client portal not found.');
    return { name: employer.name, slug: employer.slug };
  });

  // ------------------------------------------------------------------ agency

  router.post('/api/agency/uploads', async (ctx) => {
    const actor = requireAgency(ctx);
    const channelValue = optStr(ctx.body, 'channel') ?? 'pasted_text';
    const { draft, extraction } = await app.intake.uploadPost({
      channel: channelValue as Parameters<typeof app.intake.uploadPost>[0]['channel'],
      text: str(ctx.body, 'text'),
      imagePath: optStr(ctx.body, 'imagePath'),
      employerId: optStr(ctx.body, 'employerId'),
      employerName: optStr(ctx.body, 'employerName'),
      staffId: actor.id,
    });
    return { draft, extraction };
  });

  router.get('/api/agency/drafts', (ctx) => {
    requireAgency(ctx);
    const status = ctx.query.get('status');
    return { drafts: app.agency.drafts((status as 'extracted' | null) ?? undefined) };
  });

  router.get('/api/agency/drafts/:draftId', (ctx) => {
    requireAgency(ctx);
    const draft = app.store.getDraft(ctx.params.draftId ?? '');
    if (draft === null) throw AppError.notFound('Draft not found.');
    return draft;
  });

  router.patch('/api/agency/drafts/:draftId', (ctx) => {
    requireAgency(ctx);
    const corrections = ctx.body.corrections;
    if (typeof corrections !== 'object' || corrections === null) {
      throw AppError.badRequest('missing_field', '"corrections" must be an object of vacancy fields.');
    }
    return app.intake.saveCorrections(
      ctx.params.draftId ?? '',
      corrections as Record<string, unknown>,
      optStr(ctx.body, 'employerId'),
    );
  });

  router.post('/api/agency/drafts/:draftId/publish', (ctx) => {
    const actor = requireAgency(ctx);
    return app.intake.publishDraft(ctx.params.draftId ?? '', {
      staffId: actor.id,
      employerId: optStr(ctx.body, 'employerId'),
      employerName: optStr(ctx.body, 'employerName'),
      employerLocation: optStr(ctx.body, 'employerLocation'),
      employerContactEmail: optStr(ctx.body, 'employerContactEmail'),
      employerContactPhone: optStr(ctx.body, 'employerContactPhone'),
      description: optStr(ctx.body, 'description'),
    });
  });

  router.get('/api/agency/overview', (ctx) => {
    requireAgency(ctx);
    return { rows: app.agency.overview() };
  });

  router.get('/api/agency/clients', (ctx) => {
    requireAgency(ctx);
    return { clients: app.agency.clients() };
  });

  router.get('/api/agency/report', (ctx) => {
    requireAgency(ctx);
    return { report: app.agency.report(), categories: app.agency.categoryBreakdown() };
  });

  router.post('/api/agency/clients/:employerId/access', (ctx) => {
    requireAgency(ctx);
    const kind = optStr(ctx.body, 'kind') ?? 'one_time_code';
    if (kind !== 'one_time_code' && kind !== 'email_otp' && kind !== 'phone_otp') {
      throw AppError.badRequest('invalid_kind', 'Access can be resent as a one-time code or an OTP.');
    }
    return app.agency.resendAccess(ctx.params.employerId ?? '', kind, optStr(ctx.body, 'destination') ?? undefined);
  });

  router.post('/api/agency/clients/:employerId/password', (ctx) => {
    requireAgency(ctx);
    app.agency.setEmployerPassword(ctx.params.employerId ?? '', str(ctx.body, 'password'));
    return { ok: true };
  });

  router.post('/api/agency/applicants', (ctx) => {
    requireAgency(ctx);
    return app.agency.registerApplicant({
      fullName: str(ctx.body, 'fullName'),
      phone: str(ctx.body, 'phone'),
      email: optStr(ctx.body, 'email'),
      location: str(ctx.body, 'location'),
      gender: (optStr(ctx.body, 'gender') ?? 'undisclosed') as 'female' | 'male' | 'other' | 'undisclosed',
      dateOfBirth: optStr(ctx.body, 'dateOfBirth'),
      educationLevel: (optStr(ctx.body, 'educationLevel') ?? 'none') as EducationLevel,
      languages: strArray(ctx.body, 'languages'),
      willingToRelocate: optBool(ctx.body, 'willingToRelocate') ?? false,
      availableFrom: optStr(ctx.body, 'availableFrom'),
      verified: optBool(ctx.body, 'verified') ?? true,
    });
  });

  router.get('/api/agency/applicants', (ctx) => {
    requireAgency(ctx);
    return { applicants: app.agency.applicants() };
  });

  router.post('/api/agency/memberships/:membershipId/confirm', (ctx) => {
    requireAgency(ctx);
    return app.memberships.confirmPayment(
      ctx.params.membershipId ?? '',
      optNum(ctx.body, 'paidAmountTzs') ?? 0,
      str(ctx.body, 'paymentReference'),
    );
  });

  router.post('/api/agency/memberships', (ctx) => {
    requireAgency(ctx);
    return app.memberships.purchase(str(ctx.body, 'applicantId'), str(ctx.body, 'packageCode'));
  });

  router.get('/api/agency/renewals', (ctx) => {
    requireAgency(ctx);
    const days = Number(ctx.query.get('withinDays') ?? 7);
    return { renewals: app.memberships.renewalsDue(Number.isFinite(days) ? days : 7) };
  });

  /** Soko Huru shortlisting or rejecting on an employer's behalf. */
  router.post('/api/agency/applications/:applicationId/status', (ctx) => {
    const actor = requireAgency(ctx);
    const application = app.store.getApplication(ctx.params.applicationId ?? '');
    if (application === null) throw AppError.notFound('Application not found.');
    const status = statusFrom(ctx.body.status);
    const note = optStr(ctx.body, 'note');
    if (status === 'interview_invited') {
      return app.employer.inviteToInterview(
        application.employerId,
        application.id,
        optStr(ctx.body, 'interviewAt'),
        actor,
        note,
      );
    }
    return app.employer.transition(application.employerId, application.id, status, actor, note);
  });

  router.get('/api/agency/applications/:applicationId', (ctx) => {
    requireAgency(ctx);
    const application = app.store.getApplication(ctx.params.applicationId ?? '');
    if (application === null) throw AppError.notFound('Application not found.');
    const applicant = app.store.getApplicant(application.applicantId);
    const vacancy = app.store.getVacancy(application.vacancyId);
    const cv = app.store.getCv(application.cvId);
    return {
      application,
      statusLabel: STATUS_LABELS[application.status],
      applicant,
      cv,
      vacancy,
      history: app.store.listApplicationEvents(application.id),
      card:
        vacancy !== null && applicant !== null && cv !== null
          ? buildJobCard(vacancy, scoreMatch(vacancy, applicant, cv))
          : null,
    };
  });

  router.get('/api/agency/stream', (ctx) => {
    requireAgency(ctx);
    return stream(ctx, 'agency', AGENCY_SCOPE_ID);
  });

  return router;
}
