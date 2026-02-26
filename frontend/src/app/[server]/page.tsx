import { redirect } from "next/navigation";

export default async function ServerIndex({
  params,
}: {
  params: Promise<{ server: string }>;
}) {
  const { server } = await params;
  redirect(`/${server.toLowerCase()}/comps`);
}
