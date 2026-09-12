import{requireOwnerPage}from"@/lib/page-auth";export default async function Layout({children}:{children:React.ReactNode}){await requireOwnerPage();return children}
