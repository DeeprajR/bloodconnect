import { redirect } from 'next/navigation';

/**
 * Administration has no landing page. There is one thing to do here, and a
 * front door that only offers a link to it is a click nobody needs.
 */
export default function AdminRoot() {
  redirect('/doctors');
}
