#!/usr/bin/env node

/**
 * Multi-version testing script for ZeroEval TypeScript SDK
 * Tests the SDK across multiple Node.js versions using nvm or fnm
 */

const { execSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

// Node versions to test (similar to Python 3.9-3.13)
const NODE_VERSIONS = ['18.20.5', '20.18.1', '22.12.0'];

// Check if nvm or fnm is available
function getVersionManager() {
  try {
    execSync('fnm --version', { stdio: 'ignore' });
    return 'fnm';
  } catch {
    try {
      // Check if nvm is available by sourcing it first
      execSync('bash -c "source ~/.nvm/nvm.sh && nvm --version"', {
        stdio: 'ignore',
      });
      return 'nvm';
    } catch {
      console.error(
        '❌ Neither fnm nor nvm found. Please install a Node version manager.'
      );
      process.exit(1);
    }
  }
}

// Execute command with proper nvm sourcing if needed
function execute(command, options = {}) {
  const versionManager = getVersionManager();
  if (versionManager === 'nvm') {
    // For nvm, we need to source it first
    return execSync(`bash -c "source ~/.nvm/nvm.sh && ${command}"`, options);
  }
  return execSync(command, options);
}

// Run tests for a specific Node version
function runTestsForVersion(version, testType = 'all') {
  console.log(`\n📦 Testing with Node.js ${version}`);

  try {
    // Install/use the Node version
    const versionManager = getVersionManager();
    console.log(`   Installing/switching to Node.js ${version}...`);

    if (versionManager === 'fnm') {
      execute(`fnm install ${version}`, { stdio: 'inherit' });
      execute(`fnm use ${version}`, { stdio: 'inherit' });
    } else {
      execute(`nvm install ${version}`, { stdio: 'inherit' });
      execute(`nvm use ${version}`, { stdio: 'inherit' });
    }

    // Verify version
    const actualVersion = execute('node --version').toString().trim();
    console.log(`   Using Node.js ${actualVersion}`);

    // Install dependencies
    console.log('   Installing dependencies...');
    execute('npm ci', { stdio: 'inherit' });

    // Run tests based on type
    console.log(`   Running ${testType} tests...`);
    let testCommand;
    switch (testType) {
      case 'core':
        testCommand = 'npm run test:core';
        break;
      case 'perf':
        testCommand = 'npm run test:perf';
        break;
      default:
        testCommand = 'npm test';
    }

    execute(testCommand, { stdio: 'inherit' });

    return { version, status: 'passed' };
  } catch (error) {
    console.error(`❌ Tests failed for Node.js ${version}`);
    return { version, status: 'failed', error: error.message };
  }
}

// Main function
function main() {
  const args = process.argv.slice(2);
  const testType = args[0] || 'all';

  console.log('🚀 ZeroEval TypeScript SDK Multi-Version Testing');
  console.log('================================================');
  console.log(`Test type: ${testType}`);
  console.log(`Node versions: ${NODE_VERSIONS.join(', ')}`);

  const results = [];

  // Save current Node version
  const originalVersion = execute('node --version').toString().trim();

  // Run tests for each version
  for (const version of NODE_VERSIONS) {
    const result = runTestsForVersion(version, testType);
    results.push(result);
  }

  // Restore original Node version
  console.log(`\n🔄 Restoring original Node version ${originalVersion}`);
  const versionManager = getVersionManager();
  const versionNumber = originalVersion.replace('v', '');

  try {
    if (versionManager === 'fnm') {
      execute(`fnm use ${versionNumber}`, { stdio: 'inherit' });
    } else {
      execute(`nvm use ${versionNumber}`, { stdio: 'inherit' });
    }
  } catch {
    console.log(
      '   Could not restore exact version, please manually switch back.'
    );
  }

  // Print summary
  console.log('\n📊 Test Summary');
  console.log('==============');
  results.forEach(({ version, status }) => {
    const icon = status === 'passed' ? '✅' : '❌';
    console.log(`${icon} Node.js ${version}: ${status}`);
  });

  // Exit with error if any tests failed
  const hasFailures = results.some((r) => r.status === 'failed');
  process.exit(hasFailures ? 1 : 0);
}

// Run if called directly
if (require.main === module) {
  main();
}
