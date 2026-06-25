#!/usr/bin/env node

const agent = process.env.npm_config_user_agent || '';

if (!agent.startsWith('npm/')) {
  console.error('This repository is pinned to npm. Use npm install, npm ci, and npm run <script>.');
  console.error(`Detected package manager: ${agent || 'unknown'}`);
  process.exit(1);
}
