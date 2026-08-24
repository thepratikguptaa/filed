import { Console } from "@/components/console";
import { getCorpusStats } from "@/lib/corpus";

export const dynamic = "force-dynamic";

export default async function Page() {
  const stats = await getCorpusStats();
  return <Console stats={stats} />;
}
