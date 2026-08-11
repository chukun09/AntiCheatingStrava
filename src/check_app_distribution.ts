import { db } from './config/db';
import { getStravaAppPool } from './services/stravapool.service';

async function checkDistribution() {
  const pool = getStravaAppPool();
  console.log(`📋 Total configured Strava Apps in pool: ${pool.length}`);
  pool.forEach((app, i) => {
    console.log(`App ${i + 1}: Client ID ${app.clientId}`);
  });

  const users = await db.user.findMany({
    select: { id: true, nickName: true, appClientId: true }
  });

  const countMap = new Map<string, number>();
  users.forEach(u => {
    const key = u.appClientId || 'NULL (Unassigned)';
    countMap.set(key, (countMap.get(key) || 0) + 1);
  });

  console.log('\n📊 Phân bổ VĐV theo App Client ID:');
  console.log('-----------------------------------');
  countMap.forEach((count, clientId) => {
    console.log(`App Client ID: ${clientId} -> ${count} VĐV`);
  });
  console.log('-----------------------------------');

  await db.$disconnect();
}

checkDistribution();
