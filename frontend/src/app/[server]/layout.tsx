import { notFound } from "next/navigation";
import { VALID_SERVERS_SET } from "@/lib/constants";

export default async function ServerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ server: string }>;
}) {
  const { server } = await params;

  if (!VALID_SERVERS_SET.has(server.toLowerCase())) {
    notFound();
  }

  return <>{children}</>;
}
