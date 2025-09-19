import { renderConfigError } from './runtime/ConfigErrorScreen.jsx';

async function bootstrap() {
  try {
    const { renderApp } = await import('./main.jsx');
    renderApp();
  } catch (error) {
    renderConfigError(error);
  }
}

bootstrap();
