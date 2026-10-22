// Apply the saved language and theme before first paint (kept external: the server CSP forbids inline scripts).
try { if (localStorage.getItem('lang') === 'en') { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; } } catch (e) { /* ignore */ }
try { var th = localStorage.getItem('theme'); if (th === 'dark' || th === 'light') document.documentElement.setAttribute('data-theme', th); } catch (e) { /* ignore */ }
