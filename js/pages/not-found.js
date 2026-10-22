import { html } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';

export default function notFound(view, ctx) {
  ctx.setTitle('Page not found');
  return {
    render: () => html`<div class="auth" style="text-align:center">
      <div class="card auth-card stack" style="padding:36px 28px;max-width:480px">
        <div style="display:grid;place-items:center;margin:0 auto">
          <div style="width:64px;height:64px;border-radius:20px;background:var(--soft);color:var(--brand-ink);display:grid;place-items:center">${icon('map', 32)}</div>
        </div>
        <div class="stack-sm">
          <span class="label" style="letter-spacing:.12em">${t('404 Error')}</span>
          <h1 style="font-size:1.8rem">${t('Stop Not Found')}</h1>
          <p class="muted">${t('The page or route you are looking for does not exist, has been rescheduled, or is no longer in service.')}</p>
        </div>
        <div class="row" style="justify-content:center;gap:12px;margin-top:8px">
          <a href="#/" class="btn">${icon('home', 18)}${t('Return to Home')}</a>
          <a href="#/student" class="btn secondary">${icon('bus', 18)}${t('Student Portal')}</a>
        </div>
      </div>
    </div>`,
  };
}
