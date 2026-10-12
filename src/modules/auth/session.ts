export const SESSION_COOKIE = 'cv_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d

export interface SessionPayload {
  sub: string;
  email: string;
}
