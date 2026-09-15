import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";

/**
 * What a person sees when a page refuses their role.
 *
 * Rendered with a real 403, which is the point: a refusal inside a 200 tells
 * every script, crawler and client library that the request succeeded. The copy
 * says what to do instead, and names no collector — a role boundary is not a
 * place to start explaining the machinery.
 */
export default function Forbidden() {
  return (
    <>
      <PageHeader title="หน้านี้สำหรับผู้ดูแลระบบ" />
      <EmptyState
        testId="forbidden-notice"
        title="หน้านี้สำหรับผู้ดูแลระบบ"
        body="สิทธิ์ของคุณเข้าหน้านี้ไม่ได้ ถ้าต้องการข้อมูลใหม่ ให้ใช้เมนูเก็บข้อมูลใหม่"
        action={<Link href="/datasets">ไปที่ชุดข้อมูล</Link>}
      />
    </>
  );
}
