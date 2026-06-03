import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function characterReproRecorderPlugin(): Plugin {
  return {
    name: 'character-repro-recorder',
    configureServer(server) {
      server.middlewares.use('/__recordings/character-repro', async (req, res) => {
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
          const fixtureDir = path.resolve(server.config.root, 'tests/fixtures/character-repros');
          const latestPath = path.join(fixtureDir, 'latest.json');
          const timestampedPath = path.join(fixtureDir, `repro-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
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
            latestPath: path.relative(server.config.root, latestPath),
            savedPath: path.relative(server.config.root, timestampedPath),
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

export default defineConfig({
  plugins: [characterReproRecorderPlugin(), garmentPresetFixturePlugin(), animationRatingsPlugin()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
});
