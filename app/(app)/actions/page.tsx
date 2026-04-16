import { redirect } from 'next/navigation'

/**
 * Quick Actions moved to the top of the Dashboard. Old /actions bookmarks
 * redirect to the home page.
 */
export default function ActionsRedirect() {
  redirect('/')
}
