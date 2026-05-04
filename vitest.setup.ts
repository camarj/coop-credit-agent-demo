import { config } from 'dotenv';

config({ path: '.env.local' });
config(); // .env fallback if .env.local is missing
