import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'

export function GoogleCallback() {
  const navigate = useNavigate()
  const { setTokens, setUser } = useAuthStore()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code) {
      navigate('/login')
      return
    }

    const redirectUri = `${window.location.origin}/auth/google/callback`
    api
      .googleAuth(code, redirectUri)
      .then(async (tokens) => {
        setTokens(tokens.access_token, tokens.refresh_token)
        const user = await api.getMe()
        setUser(user)
        navigate('/')
      })
      .catch(() => navigate('/login'))
  }, [navigate, setTokens, setUser])

  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Signing in with Google...
    </div>
  )
}
