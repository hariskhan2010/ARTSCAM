/**
 * Version, links and the bug report (plan.md T7.4). The version comes from
 * package.json and the build's commit; both are injected by vite.config.ts.
 */

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'local';

export const REPO_URL = 'https://github.com/hariskhan2010/ARTSCAM';
export const GUIDE_URL = `${REPO_URL}/blob/main/docs/guide/README.md`;
export const SAFETY_URL = `${REPO_URL}/blob/main/docs/guide/02-before-the-first-cut.md`;

/** "0.7.0-beta (abc1234)". */
export function versionText(): string {
  return `${APP_VERSION} (${APP_BUILD})`;
}

/**
 * A new bug report on GitHub with the version and browser filled in. The
 * query keys are the field ids in .github/ISSUE_TEMPLATE/bug.yml.
 */
export function bugReportUrl(userAgent: string): string {
  const q = new URLSearchParams({
    template: 'bug.yml',
    version: versionText(),
    browser: userAgent,
  });
  return `${REPO_URL}/issues/new?${q.toString()}`;
}
