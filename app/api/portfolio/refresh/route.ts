import { GET as livePortfolioGET } from "@/app/api/portfolio/route";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return livePortfolioGET(request);
}
