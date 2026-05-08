import { notFound } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';
import { deriveMode } from '@/lib/streaming/derive-mode';
import { LiveView } from '@/components/graph/live-view';
import { PersistedView } from './_persisted-view';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ApplicationPage({ params }: PageProps) {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    notFound();
  }

  const [app] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1);

  if (!app) {
    notFound();
  }

  const states = await db
    .select()
    .from(applicationStates)
    .where(eq(applicationStates.applicationId, id))
    .orderBy(asc(applicationStates.version));

  const mode = deriveMode(states);

  if (mode === 'live') {
    return <LiveView applicationId={id} />;
  }

  return <PersistedView applicationId={id} states={states} />;
}
