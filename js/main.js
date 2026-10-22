import './core/theme.js';
import { startRouter } from './core/router.js';
import { installGlobalHandlers } from './components/global.js';
import { routes } from './app.js';

installGlobalHandlers();
startRouter(document.getElementById('root'), routes);
