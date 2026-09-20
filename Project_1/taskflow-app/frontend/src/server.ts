import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

type ProxyConfig = Record<string, { target: string }>;

const proxyConfigPath = join(import.meta.dirname, '../../../proxy.conf.json');
let proxyConfig: ProxyConfig = {};

try {
  proxyConfig = JSON.parse(readFileSync(proxyConfigPath, 'utf8')) as ProxyConfig;
} catch {
  // Deployment environments can provide API targets through environment variables.
}

const weatherApiUrl = process.env['TASKFLOW_WEATHER_API_URL'] ||
  proxyConfig['/api/weather']?.target;
const usersApiUrl = process.env['TASKFLOW_USERS_API_URL'] ||
  proxyConfig['/api/users']?.target;

const proxyApiRequest = async (
  apiUrl: string,
  path: string,
  res: express.Response,
  next: express.NextFunction,
) => {
  try {
    const response = await fetch(`${apiUrl}${path}`);
    const body = await response.text();

    res
      .status(response.status)
      .type(response.headers.get('content-type') || 'application/json')
      .send(body);
  } catch (error) {
    next(error);
  }
};

app.get('/api/weather', (_req, res, next) => {
  if (!weatherApiUrl) {
    next(new Error('Weather API URL is not configured.'));
    return;
  }

  proxyApiRequest(weatherApiUrl, '/api/weather', res, next);
});

app.get('/api/users', (_req, res, next) => {
  if (!usersApiUrl) {
    next(new Error('Users API URL is not configured.'));
    return;
  }

  proxyApiRequest(usersApiUrl, '/api/users', res, next);
});

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = Number(process.env['PORT']) || 4000;
  app.listen(port, '0.0.0.0', (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
