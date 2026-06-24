import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import ClientHome from './ClientHome'

export default async function Page() {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  let profiles: any[] | null = null
  let dbError: string | null = null

  try {
    const { data, error } = await supabase.from('profiles').select('id, full_name, email').limit(5)
    if (error) {
      dbError = error.message
    } else {
      profiles = data
    }
  } catch (err: any) {
    dbError = err.message || "Failed to establish secure database connection."
  }

  return <ClientHome initialTodos={profiles} dbError={dbError} />
}
