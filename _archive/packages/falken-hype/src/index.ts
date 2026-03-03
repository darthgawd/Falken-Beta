import { TwitterApi } from 'twitter-api-v2';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

/**
 * 1. Get recent git history to understand what we've built
 */
function getRecentChanges(): string {
  try {
    // Get last 5 commit messages
    const logs = execSync('git log -n 5 --pretty=format:"%s"').toString();
    // Get summary of changed files in last commit
    const stats = execSync('git diff --stat HEAD~1 HEAD').toString();
    return `Recent Commits:
${logs}

File Changes:
${stats}`;
  } catch (err) {
    logger.error('Failed to get git history');
    return 'Building the future of the machine economy.';
  }
}

/**
 * 2. Use Gemini to translate code into "Hype"
 */
async function generateHypeTweet(changes: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY missing, using fallback template');
    return `Falken Protocol is evolving. The Arena is getting sharper. 🧠 Built on @base 🔵 #AI #Falken`;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
    You are the lead marketing voice for Falken Protocol. 
    Falken is a high-stakes adversarial arena where AI agents compete for ETH.
    It features Immutable Scripting (JS on IPFS) and autonomous evolution.
    
    Here are the technical changes we just pushed to the codebase:
    ${changes}
    
    Task: Write a punchy, visionary, and slightly aggressive tweet about this progress.
    Guidelines:
    - Focus on the "Machine Economy" or "Agentic Sovereignty".
    - Mention #Base and use the 🔵 emoji.
    - No corporate fluff. Keep it raw and founder-led.
    - Maximum 280 characters.
    - Don't use quotes around the tweet.
  `;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err: any) {
    logger.error({ err: err.message }, 'Gemini API failed. Using local template.');
    return `Falken Protocol: The Sovereign Machine Economy is arriving on @base 🔵\n\nAdversarial AI. Immutable Logic. Real ETH stakes.\n\nJoin the waitlist: [Link] #AI #Base #Falken`;
  }
}

/**
 * 3. Main execution
 */
async function run() {
  const mode = process.argv.includes('--post') ? 'POST' : 'GENERATE';
  
  logger.info({ mode }, '🚀 Falken Hype Bot starting...');
  
  const changes = getRecentChanges();
  const tweet = await generateHypeTweet(changes);
  
  console.log('\n--- PROPOSED TWEET ---');
  console.log(tweet);
  console.log('----------------------\n');

  if (mode === 'POST') {
    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY || '',
      appSecret: process.env.TWITTER_API_SECRET || '',
      accessToken: process.env.TWITTER_ACCESS_TOKEN || '',
      accessSecret: process.env.TWITTER_ACCESS_SECRET || '',
    });

    const rwClient = client.readWrite;

    try {
      await rwClient.v2.tweet(tweet);
      logger.info('✅ Tweet successfully broadcasted to the machine world.');
    } catch (err: any) {
      const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`;
      logger.error({ 
        err: err.message, 
        code: err.code 
      }, '❌ API Broadcast Failed. Credits might be depleted or account restricted.');
      
      console.log('\n--- MANUAL POST FALLBACK ---');
      console.log('Copy/Paste this tweet or use the link below:');
      console.log('\n' + tweet + '\n');
      console.log('Link: ' + tweetUrl);
      console.log('----------------------------\n');
    }
  }
}

run().catch(console.error);
