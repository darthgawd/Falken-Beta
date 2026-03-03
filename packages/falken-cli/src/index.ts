#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { deployCommand } from './commands/deploy.js';

const program = new Command();

program
  .name('falken')
  .description('Falken Protocol: The Autonomous Machine Intelligence CLI')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new Falken Agent locally')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(initCommand);

program
  .command('deploy <file>')
  .description('Deploy immutable game logic to the Falken Scripting Engine (FISE)')
  .option('-n, --name <name>', 'Logical name for the game')
  .action(deployCommand);

program.parse();
