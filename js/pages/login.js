import { html } from '../core/dom.js';
import { field } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { currentUser, login, register } from '../core/auth.js';
import { langSwitch, themeSwitch } from '../components/switches.js';

const DEMO = { student: { email: 'student@campus.test', password: 'Student#12345' }, admin: { email: 'admin@campus.test', password: 'Admin#12345' } };

function loginPage(role) {
  return function page(view, ctx) {
    const home = `/${role}`;
    ctx.setTitle(role === 'admin' ? 'Admin sign in' : 'Student sign in');
    Object.assign(view.state, { mode: 'login', f: { name: '', email: '', password: '', student_no: '' }, err: '', busy: false });
    // already signed in: go straight to the area
    currentUser(role).then((u) => { if (u && !view.destroyed) ctx.navigate(ctx.state?.from || home, { replace: true }); });

    return {
      render: () => {
        const { mode, f, err, busy } = view.state;
        return html`<div class="auth ${role}">
          <div class="card auth-card">
            <a href="#/" class="brand" style="color:var(--ink)"><span class="brand-mark">${icon('bus')}</span>${t('Campus in Motion')}</a>
            <div class="row between">
              <h1 style="font-size:1.5rem">${role === 'admin' ? t('Administrator sign in') : mode === 'login' ? t('Student sign in') : t('Create student account')}</h1>
              <span class="role-tag" style="background:var(--ink);color:#fff">${role === 'admin' ? t('Administrator') : t('Student')}</span>
            </div>
            ${role === 'admin' ? html`<div class="alert info">${icon('shield', 18)}${t('Staff area. Student accounts cannot sign in here.')}</div>` : ''}
            ${mode === 'login' ? html`<div class="alert info" role="note">
              <div>${t('Demo mode: no server is needed.')} <b dir="ltr">${DEMO[role].email}</b> / <b dir="ltr">${DEMO[role].password}</b>
                <button type="button" class="btn sm secondary" data-click="fill">${t('Fill in')}</button></div>
            </div>` : ''}
            <form data-submit="submit" class="stack" novalidate>
              ${mode === 'register' ? field({ label: t('Full name'), id: 'name' }, html`<input id="name" class="input" data-bind="f.name" value="${f.name}" autocomplete="name" required>`) : ''}
              ${field({ label: t('Email'), id: 'email' }, html`<input id="email" type="email" class="input" data-bind="f.email" value="${f.email}" autocomplete="username" required>`)}
              ${mode === 'register' ? field({ label: t('Student number (optional)'), id: 'sno' }, html`<input id="sno" class="input" data-bind="f.student_no" value="${f.student_no}">`) : ''}
              ${field({ label: t('Password'), id: 'pw', hint: mode === 'register' ? t('At least 8 characters with letters and numbers.') : undefined },
                html`<input id="pw" type="password" class="input" data-bind="f.password" value="${f.password}" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>`)}
              ${err ? html`<div class="alert error" role="alert">${err}</div>` : ''}
              <button class="btn" ${busy ? 'disabled' : ''}>${busy ? t('Please wait…') : mode === 'login' ? t('Sign in') : t('Create account')}</button>
            </form>
            ${role === 'student' ? html`<button class="btn ghost" type="button" data-click="switch">${mode === 'login' ? t('New here? Create a student account') : t('Have an account? Sign in')}</button>` : ''}
            <div class="small muted">${role === 'admin' ? html`<a href="#/student/login">${t('Student? Go to student sign in')}</a>` : html`<a href="#/admin/login">${t('Staff? Go to administrator sign in')}</a>`}</div>
            <div class="row">${langSwitch()}${themeSwitch()}</div>
          </div>
        </div>`;
      },
      actions: {
        fill: () => view.set({ f: { ...view.state.f, ...DEMO[role] } }),
        switch: () => view.set({ mode: view.state.mode === 'login' ? 'register' : 'login', err: '' }),
        submit: async () => {
          const { mode, f } = view.state;
          view.set({ err: '', busy: true });
          try {
            if (mode === 'login') await login(role, f.email, f.password);
            else await register(role, { name: f.name, email: f.email, password: f.password, student_no: f.student_no || undefined });
            ctx.navigate(ctx.state?.from || home, { replace: true });
          } catch (e) { view.set({ err: e.message, busy: false }); }
        },
      },
    };
  };
}
export const student = loginPage('student');
export const admin = loginPage('admin');
