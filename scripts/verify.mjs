import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const checks = [
  ['typecheck', ['run', 'typecheck']],
  ['test', ['run', 'test']],
  ['build', ['run', 'build']],
  ['size', ['run', 'size']],
];

for (const [name, args] of checks) {
  console.log(`\n▶ ${name}: npm ${args.join(' ')}`);
  const result = spawnSync(`${npm} ${args.join(' ')}`, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`\n✗ ${name} failed`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n✓ all checks passed');
