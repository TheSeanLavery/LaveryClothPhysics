import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function clothFixtureSaveHandler(fixtureSubdir: string, filenamePrefix: string) {
  return async (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
    root: string,
  ): Promise<void> => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const parsed = JSON.parse(raw) as unknown;
      const fixtureDir = path.resolve(root, 'tests/fixtures', fixtureSubdir);
      const latestPath = path.join(fixtureDir, 'latest.json');
      const timestampedPath = path.join(
        fixtureDir,
        `${filenamePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      );
      const pretty = `${JSON.stringify(parsed, null, 2)}\n`;

      await mkdir(fixtureDir, { recursive: true });
      await Promise.all([
        writeFile(latestPath, pretty, 'utf8'),
        writeFile(timestampedPath, pretty, 'utf8'),
      ]);

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        latestPath: path.relative(root, latestPath),
        savedPath: path.relative(root, timestampedPath),
      }));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };
}

function clothReproRecorderPlugin(): Plugin {
  return {
    name: 'cloth-repro-recorder',
    configureServer(server) {
      server.middlewares.use('/__recordings/character-repro', (req, res) => {
        void clothFixtureSaveHandler('character-repros', 'repro')(req, res, server.config.root);
      });
      server.middlewares.use('/__recordings/multi-material-repro', (req, res) => {
        void clothFixtureSaveHandler('multi-material-repros', 'repro')(req, res, server.config.root);
      });
      server.middlewares.use('/__recordings/multi-material-snapshot', (req, res) => {
        void clothFixtureSaveHandler('multi-material-snapshots', 'snapshot')(req, res, server.config.root);
      });
    },
  };
}

function garmentPresetFixturePlugin(): Plugin {
  return {
    name: 'garment-preset-fixtures',
    configureServer(server) {
      server.middlewares.use('/__garments/presets', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const raw = Buffer.concat(chunks).toString('utf8');
          const parsed = JSON.parse(raw) as { name?: string; garmentType?: string };
          const fixtureDir = path.resolve(server.config.root, 'tests/fixtures/garment-presets');
          const slug = safeFixtureSlug(`${parsed.garmentType ?? 'garment'}-${parsed.name ?? 'preset'}`);
          const latestPath = path.join(fixtureDir, 'latest.json');
          const savedPath = path.join(
            fixtureDir,
            `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
          );
          const pretty = `${JSON.stringify(parsed, null, 2)}\n`;

          await mkdir(fixtureDir, { recursive: true });
          await Promise.all([
            writeFile(latestPath, pretty, 'utf8'),
            writeFile(savedPath, pretty, 'utf8'),
          ]);

          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({
            ok: true,
            latestPath: path.relative(server.config.root, latestPath),
            savedPath: path.relative(server.config.root, savedPath),
          }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });
    },
  };
}

function safeFixtureSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'garment-preset';
}

function animationRatingsPlugin(): Plugin {
  return {
    name: 'animation-ratings',
    configureServer(server) {
      const ratingsPath = path.resolve(server.config.root, 'data/animationRatings.json');

      server.middlewares.use('/__animations/ratings', async (req, res) => {
        if (req.method === 'GET') {
          try {
            const data = await readFile(ratingsPath, 'utf8');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(data);
          } catch {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end('{}');
          }
          return;
        }

        if (req.method === 'POST') {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const raw = Buffer.concat(chunks).toString('utf8');
            const parsed = JSON.parse(raw);
            await writeFile(ratingsPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
          }
          return;
        }

        res.statusCode = 405;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      });
    },
  };
}

function clothMaterialsPlugin(): Plugin {
  return {
    name: 'cloth-materials-library',
    configureServer(server) {
      const materialsPath = path.resolve(server.config.root, 'data/clothMaterials.json');

      server.middlewares.use('/__cloth/materials', async (req, res) => {
        if (req.method === 'GET') {
          try {
            const data = await readFile(materialsPath, 'utf8');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(data);
          } catch {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end('{"version":1,"materials":[]}');
          }
          return;
        }

        if (req.method === 'POST') {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const raw = Buffer.concat(chunks).toString('utf8');
            const parsed = JSON.parse(raw);
            await mkdir(path.dirname(materialsPath), { recursive: true });
            await writeFile(materialsPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
          return;
        }

        res.statusCode = 405;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      });
    },
  };
}

function characterDuelAnimationPlugin(): Plugin {
  return {
    name: 'character-duel-animation',
    configureServer(server) {
      const setupPath = path.resolve(server.config.root, 'data/characterDuelAnimation.json');

      server.middlewares.use('/__character-duel/animation', async (req, res) => {
        if (req.method === 'GET') {
          try {
            const data = await readFile(setupPath, 'utf8');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(data);
          } catch {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end('{"version":1,"fighterA":{"profile":{"id":"duel-fighter"}},"fighterB":{"profile":{"id":"duel-brawler"}}}');
          }
          return;
        }

        if (req.method === 'POST') {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const raw = Buffer.concat(chunks).toString('utf8');
            const parsed = JSON.parse(raw);
            await mkdir(path.dirname(setupPath), { recursive: true });
            await writeFile(setupPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
          return;
        }

        res.statusCode = 405;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      });
    },
  };
}

function animationSubclipsPlugin(): Plugin {
  return {
    name: 'animation-subclips',
    configureServer(server) {
      const subclipsPath = path.resolve(server.config.root, 'data/animationSubclips.json');

      server.middlewares.use('/__animations/subclips', async (req, res) => {
        if (req.method === 'GET') {
          try {
            const data = await readFile(subclipsPath, 'utf8');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(data);
          } catch {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end('{"version":1,"subclips":{}}');
          }
          return;
        }

        if (req.method === 'POST') {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const raw = Buffer.concat(chunks).toString('utf8');
            const parsed = JSON.parse(raw);
            await mkdir(path.dirname(subclipsPath), { recursive: true });
            await writeFile(subclipsPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
          return;
        }

        res.statusCode = 405;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      });
    },
  };
}

export default defineConfig({
  plugins: [
    clothReproRecorderPlugin(),
    garmentPresetFixturePlugin(),
    animationRatingsPlugin(),
    animationSubclipsPlugin(),
    characterDuelAnimationPlugin(),
    clothMaterialsPlugin(),
  ],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    watch: {
      // POST saves from clip editor / duel FSM; app refreshes via fetch, not HMR.
      ignored: [
        '**/data/animationSubclips.json',
        '**/data/characterDuelAnimation.json',
        '**/data/clothMaterials.json',
      ],
    },
  },
});
