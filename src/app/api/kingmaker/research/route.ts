import { hasValidAdminRequest } from '../../../../lib/admin-request-auth';
import { postInstaCompMacRegistry } from '../../../../lib/instacomp-mac-registry-client';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
 if (!await hasValidAdminRequest(request)) return Response.json({error:'Owner login required'},{status:401});
 if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({error:'Invalid origin'},{status:403});
 try { const body = await request.json(); return Response.json(await postInstaCompMacRegistry('/v1/research-queue',body)); }
 catch(e) { return Response.json({error:e instanceof Error?e.message:'Research request failed'},{status:400}); }
}
