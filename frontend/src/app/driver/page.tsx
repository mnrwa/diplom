/**
 * /driver — редирект на единый личный кабинет /lk.
 * Водитель видит своё рабочее место там.
 */
import { redirect } from "next/navigation";

export default function DriverPage() {
  redirect("/lk");
}
