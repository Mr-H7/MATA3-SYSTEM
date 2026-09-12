import {PrismaClient, Gender, ProductStatus, InventoryType, MarketScope} from '@prisma/client';
import {hashPassword} from '../lib/password';
const p=new PrismaClient();
async function main(){
 const ownerPassword=process.env.SEED_OWNER_PASSWORD; const sellerPassword=process.env.SEED_SELLER_PASSWORD;
 if(!ownerPassword||!sellerPassword)throw new Error('SEED_OWNER_PASSWORD and SEED_SELLER_PASSWORD are required for seeding');
 const ownerHash=await hashPassword(ownerPassword); const sellerHash=await hashPassword(sellerPassword);
 await p.user.upsert({where:{email:'owner@mata3.local'},update:{username:'Haytham',name:'Haytham',passwordHash:ownerHash,role:'OWNER',marketScope:MarketScope.ALL,active:true},create:{id:'demo-owner',username:'Haytham',name:'Haytham',email:'owner@mata3.local',passwordHash:ownerHash,role:'OWNER',marketScope:MarketScope.ALL,active:true}});
 await p.user.upsert({where:{email:'poha@mata3.local'},update:{username:'poha',name:'Mostapha',passwordHash:sellerHash,role:'SELLER',marketScope:MarketScope.MOROCCO,active:true},create:{username:'poha',name:'Mostapha',email:'poha@mata3.local',passwordHash:sellerHash,role:'SELLER',marketScope:MarketScope.MOROCCO,active:true}});
 const egypt=await p.market.upsert({where:{code:'EGYPT'},update:{timezone:'Africa/Cairo'},create:{code:'EGYPT',name:'Egypt',currency:'EGP',timezone:'Africa/Cairo'}}); const morocco=await p.market.upsert({where:{code:'MOROCCO'},update:{timezone:'Africa/Casablanca'},create:{code:'MOROCCO',name:'Morocco',currency:'MAD',timezone:'Africa/Casablanca'}});
 const dept=await p.department.upsert({where:{name:'Gaming'},update:{},create:{name:'Gaming'}}); const cat=await p.category.upsert({where:{id:'seed-gaming'},update:{},create:{id:'seed-gaming',name:'Gaming',departmentId:dept.id}});
 const product=await p.product.upsert({where:{sku:'MATA3-DEMO-001'},update:{},create:{sku:'MATA3-DEMO-001',nameEn:'PS4 Themed Controller',nameAr:'يد تحكم بلايستيشن',departmentId:dept.id,categoryId:cat.id,gender:Gender.UNISEX,status:ProductStatus.ACTIVE}});
 const variant=await p.productVariant.upsert({where:{sku:'MATA3-DEMO-001-BLK'},update:{},create:{sku:'MATA3-DEMO-001-BLK',productId:product.id,color:'Black'}});
 for(const [market,cost,price,stock] of [[egypt,450,649,4],[morocco,520,799,2]] as const){const listing=await p.marketListing.upsert({where:{variantId_marketId:{variantId:variant.id,marketId:market.id}},update:{},create:{productId:product.id,variantId:variant.id,marketId:market.id,cost,price,inventoryType:InventoryType.PHYSICAL_STOCK}});await p.inventory.upsert({where:{listingId:listing.id},update:{},create:{listingId:listing.id,marketId:market.id,currentStock:stock}})}
}
main().finally(()=>p.$disconnect());
