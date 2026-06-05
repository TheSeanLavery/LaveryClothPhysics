import { APP_MODE_LINKS, getAppMode } from './routes';
import { makeDraggable } from '../ui/draggableFloating.ts';

const DASHBOARD_OPEN_CLASS = 'dev-dashboard-open';

export function setupDeveloperDashboard(): void {
  if (document.querySelector('[data-testid="dev-dashboard"]')) {
    return;
  }

  const dashboard = document.createElement('nav');
  dashboard.className = 'dev-dashboard';
  dashboard.setAttribute('data-testid', 'dev-dashboard');
  dashboard.setAttribute('aria-label', 'Developer dashboard');

  const surface = document.createElement('div');
  surface.className = 'dev-dashboard__surface';

  const header = document.createElement('div');
  header.className = 'dev-dashboard__header';

  const title = document.createElement('div');
  title.className = 'dev-dashboard__title';
  title.textContent = 'Dev routes';

  const toggle = document.createElement('button');
  toggle.className = 'dev-dashboard__toggle';
  toggle.type = 'button';
  toggle.textContent = 'Open';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('data-testid', 'dev-dashboard-toggle');

  const links = document.createElement('div');
  links.className = 'dev-dashboard__links';
  links.setAttribute('data-testid', 'dev-dashboard-links');

  const currentMode = getAppMode();
  for (const link of APP_MODE_LINKS) {
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.textContent = link.label;
    anchor.title = link.description;
    anchor.dataset.mode = link.mode;
    if (link.mode === currentMode) {
      anchor.setAttribute('aria-current', 'page');
    }
    links.appendChild(anchor);
  }

  const hint = document.createElement('p');
  hint.className = 'dev-dashboard__hint';
  hint.textContent = 'Hover top edge, then pin open.';

  toggle.addEventListener('click', () => {
    const open = !dashboard.classList.contains(DASHBOARD_OPEN_CLASS);
    dashboard.classList.toggle(DASHBOARD_OPEN_CLASS, open);
    toggle.textContent = open ? 'Close' : 'Open';
    toggle.setAttribute('aria-expanded', String(open));
  });

  header.append(title, toggle);
  surface.append(header, links, hint);
  dashboard.appendChild(surface);
  document.body.prepend(dashboard);
  makeDraggable(surface, { handle: header });
}
