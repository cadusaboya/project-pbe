import { notFound } from "next/navigation";

const VALID_SERVERS = new Set(["pbe", "live", "scrims"]);

export default async function ServerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ server: string }>;
}) {
  const { server } = await params;

  if (!VALID_SERVERS.has(server.toLowerCase())) {
    notFound();
  }

  return <>{children}</>;
}
