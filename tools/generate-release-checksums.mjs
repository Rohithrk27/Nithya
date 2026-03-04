import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

const RELEASE_DIR = path.resolve(process.cwd(), 'release-apk-files');
const OUTPUT_FILE = path.join(RELEASE_DIR, 'SHA256SUMS.txt');
const SUPPORTED_EXTENSIONS = new Set(['.apk', '.aab', '.pem']);

const hashFile = async (filePath) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  stream.on('error', reject);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

const main = async () => {
  await fs.mkdir(RELEASE_DIR, { recursive: true });
  const entries = await fs.readdir(RELEASE_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    const emptyContent = '# No release artifacts found.\n';
    await fs.writeFile(OUTPUT_FILE, emptyContent, 'utf8');
    console.log(`Wrote ${OUTPUT_FILE}`);
    return;
  }

  const lines = [];
  for (const fileName of files) {
    const filePath = path.join(RELEASE_DIR, fileName);
    const digest = await hashFile(filePath);
    lines.push(`${digest}  ${fileName}`);
  }

  const content = `${lines.join('\n')}\n`;
  await fs.writeFile(OUTPUT_FILE, content, 'utf8');
  console.log(`Wrote ${OUTPUT_FILE}`);
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
