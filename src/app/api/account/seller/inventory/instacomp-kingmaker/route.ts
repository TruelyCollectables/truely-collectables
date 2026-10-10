import { NextRequest, NextResponse } from "next/server";
import { ensureAccountStoreMembership, getAuthenticatedAccountFromRequest } from "../../../../../../lib/account-auth";
import { kingmakerMacRequest } from "../../../../../../lib/kingmaker-mac-server";
import { listMacKingmakerInventory } from "../../../../../../lib/kingmaker-mac-scan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const MAX_WORKBENCH_CARDS = 100;
type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function text(value: unknown, maximum=2000) { const v=String(value??"").replace(/\s+/g," ").trim(); return v ? v.slice(0,maximum) : null; }
function num(value: unknown) { const n=Number(value); return Number.isFinite(n)?n:0; }
function list(value: unknown, limit=30) { return Array.isArray(value)?value.map(v=>text(v,240)).filter(Boolean).slice(0,limit):[]; }

export async function GET(request: NextRequest) {
  const startedAt=Date.now();
  try {
    const account=await getAuthenticatedAccountFromRequest(request);
    if(!account) return NextResponse.json({success:false,error:"Unauthorized"},{status:401});
    await ensureAccountStoreMembership({accountId:account.id,role:"seller",status:"active"});
    const [{items}, operations]=await Promise.all([listMacKingmakerInventory(), kingmakerMacRequest<Record<string, any>>("/v1/kingmaker/operations")]);
    const rows=items.filter(item=>item.status==="draft").sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||""))).slice(0,MAX_WORKBENCH_CARDS);
    const output=rows.map(item=>{
      const metadata=record(item.metadata), instacomp=record(metadata.instacomp), ai=record(instacomp.ai), orientation=record(instacomp.imageOrientation), checklist=record(instacomp.checklistDecision), parallel=record(instacomp.parallelDecision);
      const identityComplete=instacomp.identityComplete===true, locked=instacomp.manualIdentityLocked===true;
      const front=text(instacomp.frontImageUrl), back=text(instacomp.backImageUrl);
      return {
        inventoryItemId:item.inventoryItemId,title:text(item.title,240)||"Untitled card",sku:text(item.sku,120),updatedAt:item.updatedAt||null,
        imageAudit:{frontImageUrl:front,backImageUrl:back,frontFound:Boolean(front),backFound:Boolean(back),distinctUrls:Boolean(front&&back&&front!==back),storedImageCount:Number(Boolean(front))+Number(Boolean(back)),readyForAutomaticScan:Boolean(front&&back&&front!==back)},
        identity:{identityComplete,locked,humanVerified:instacomp.humanVerified===true,trustedForIdentity:instacomp.trustedForIdentity===true,savedAt:text(instacomp.manualIdentitySavedAt,80),source:text(instacomp.identitySource,160),player:text(ai.player||ai.playerName,180),year:text(ai.year,20),manufacturer:text(ai.manufacturer||ai.brand,120),setName:text(ai.setName||ai.set,200),cardNumber:text(ai.cardNumber||ai.card_number,80),parallel:text(ai.checklistParallel||ai.parallelName||ai.parallel,160)||(identityComplete?"Base":null),variation:text(ai.variation,160),serialNumber:text(ai.serialNumber||ai.printRun,120),sport:text(ai.sport,120),team:text(ai.team,180),isAuto:ai.isAuto===true,isRelic:ai.isRelic===true},
        orientation:{persisted:instacomp.imageOrientationPersisted===true,status:text(orientation.status,80),model:text(orientation.model||orientation.source,120),frontRotation:num(orientation.frontRotation),backRotation:num(orientation.backRotation),frontConfidence:num(orientation.frontConfidence),backConfidence:num(orientation.backConfidence),frontEvidenceText:list(orientation.frontEvidenceText,12),backEvidenceText:list(orientation.backEvidenceText,12),reason:text(orientation.reason,1000)},
        checklist:{status:text(checklist.status,80),candidateCount:num(checklist.candidateCount),reasons:list(checklist.reasons),candidateIdentityIds:list(checklist.candidateIdentityIds,100),parallelStatus:text(parallel.status,80),selectedParallel:text(parallel.selectedParallel,160),parallelConfidence:num(parallel.confidence),parallelEvidence:text(parallel.evidence,1000),candidateParallels:list(parallel.candidateParallels,100)},
        scan:{scanId:text(instacomp.scanId,100),lastStatus:text(instacomp.lastStatus,80),lastStage:text(instacomp.lastStage,80),lastError:text(instacomp.lastError,1000),lastErrorCode:text(instacomp.lastErrorCode,120),pricingStatus:text(instacomp.pricingStatus,120),pricingReason:text(instacomp.pricingReason,1000),learningPromotion:record(instacomp.learningPromotion)},
      };
    });
    const registryRows=Number(record(record(operations).databases).checklistRegistry && record(record(record(operations).databases).checklistRegistry).rows || 0);
    return NextResponse.json({success:true,generatedAt:new Date().toISOString(),durationMs:Date.now()-startedAt,limit:MAX_WORKBENCH_CARDS,coverage:{available:true,activeLiveVersions:0,activeLiveCards:registryRows,error:null,sourceOfTruth:"mac_local"},items:output},{headers:{"Cache-Control":"private, no-store, max-age=0"}});
  } catch(error) { return NextResponse.json({success:false,error:error instanceof Error?error.message:"KINGMAKER workbench failed to load.",durationMs:Date.now()-startedAt},{status:500}); }
}
