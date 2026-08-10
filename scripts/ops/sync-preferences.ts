import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '../../src/lib/db/prisma';

async function main() {
  console.log('Fetching user preferences...');
  
  const vishnu = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mis_email_preferences FROM app_users WHERE email = $1`,
    'vishunvishwakarma90211@gmail.com'
  );

  if (!vishnu || vishnu.length === 0) {
    throw new Error('User vishunvishwakarma90211@gmail.com not found');
  }

  const vishnuPrefs = vishnu[0].mis_email_preferences;
  console.log('Original preferences from vishunvishwakarma90211@gmail.com:', JSON.stringify(vishnuPrefs, null, 2));

  // Copy configurations, but set subscribed = true for the 9:30 mail account (mis.service@westernequipments.com)
  const targetPrefs = {
    ...vishnuPrefs,
    subscribed: true,
    sendTimeIst: '09:30' // Ensure it is exactly 9:30
  };

  console.log('Updating mis.service@westernequipments.com with preferences:', JSON.stringify(targetPrefs, null, 2));

  await prisma.$executeRawUnsafe(
    `UPDATE app_users SET mis_email_preferences = $1::jsonb WHERE email = $2`,
    JSON.stringify(targetPrefs),
    'mis.service@westernequipments.com'
  );

  // Ensure vishunvishwakarma90211@gmail.com itself is subscribed = false so no other mail is triggered
  const vishnuNewPrefs = {
    ...vishnuPrefs,
    subscribed: false
  };

  console.log('Ensuring vishunvishwakarma90211@gmail.com remains unsubscribed...');
  await prisma.$executeRawUnsafe(
    `UPDATE app_users SET mis_email_preferences = $1::jsonb WHERE email = $2`,
    JSON.stringify(vishnuNewPrefs),
    'vishunvishwakarma90211@gmail.com'
  );

  console.log('Verification: fetching both users again...');
  const verifyResult = await prisma.$queryRawUnsafe<any[]>(
    `SELECT email, mis_email_enabled, mis_email_preferences FROM app_users WHERE email IN ($1, $2)`,
    'vishunvishwakarma90211@gmail.com',
    'mis.service@westernequipments.com'
  );

  for (const u of verifyResult) {
    console.log(`\nEmail: ${u.email}`);
    console.log(`Enabled: ${u.mis_email_enabled}`);
    console.log(`Prefs:`, JSON.stringify(u.mis_email_preferences, null, 2));
  }
}

main().catch(console.error);
