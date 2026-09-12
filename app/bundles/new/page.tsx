import Link from "next/link";
import BundleForm from "../bundle-form";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function NewBundlePage() { const listings = await prisma.marketListing.findMany({ include: { product: true, variant: true }, orderBy: { product: { nameEn: "asc" } } }); const choices = listings.filter((listing,index,array)=>array.findIndex((candidate)=>candidate.productId===listing.productId&&candidate.variantId===listing.variantId)===index).map((listing)=>({productId:listing.productId,variantId:listing.variantId,label:`${listing.product.nameEn}${listing.variant?` — ${listing.variant.sku}`:""}`})); return <main className="p-8 max-w-4xl"><Link className="gold" href="/bundles">← Bundles</Link><h1 className="text-3xl font-bold my-5">New Bundle</h1><BundleForm choices={choices}/></main>; }
