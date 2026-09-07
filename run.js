const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const venvPython = isWin
  ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
  : path.join(__dirname, '.venv', 'bin', 'python');

const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python';
const targetScript = process.argv[2] || 'backend/app.py';
const scriptArgs = process.argv.slice(3);

const proc = spawn(pythonBin, [targetScript, ...scriptArgs], {
  stdio: 'inherit'
});

proc.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
