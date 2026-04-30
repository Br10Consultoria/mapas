import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import axios from 'axios'

const API_BASE = '/api/v1'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number
  username: string
  email: string | null
  full_name: string | null
  is_superuser: boolean
  totp_enabled: boolean
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<LoginResult>
  verify2FA: (preAuthToken: string, code: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

export interface LoginResult {
  requires2FA: boolean
  preAuthToken?: string
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────

const STORAGE_ACCESS  = 'netmap_access_token'
const STORAGE_REFRESH = 'netmap_refresh_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isLoading: true,
  })

  // Configura o axios com o token atual
  const setAxiosToken = useCallback((token: string | null) => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    } else {
      delete axios.defaults.headers.common['Authorization']
    }
  }, [])

  // Busca dados do usuário atual
  const fetchMe = useCallback(async (token: string): Promise<AuthUser | null> => {
    try {
      const res = await axios.get(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.data
    } catch {
      return null
    }
  }, [])

  // Tenta renovar o access token usando o refresh token
  const tryRefresh = useCallback(async (): Promise<string | null> => {
    const refreshToken = localStorage.getItem(STORAGE_REFRESH)
    if (!refreshToken) return null
    try {
      const res = await axios.post(`${API_BASE}/auth/refresh`, { refresh_token: refreshToken })
      return res.data.access_token
    } catch {
      return null
    }
  }, [])

  // Inicialização: verifica token salvo
  useEffect(() => {
    const init = async () => {
      const savedToken = localStorage.getItem(STORAGE_ACCESS)
      if (!savedToken) {
        setState(s => ({ ...s, isLoading: false }))
        return
      }

      setAxiosToken(savedToken)
      let user = await fetchMe(savedToken)

      if (!user) {
        // Token expirado — tenta refresh
        const newToken = await tryRefresh()
        if (newToken) {
          localStorage.setItem(STORAGE_ACCESS, newToken)
          setAxiosToken(newToken)
          user = await fetchMe(newToken)
          if (user) {
            setState({ user, accessToken: newToken, isAuthenticated: true, isLoading: false })
            return
          }
        }
        // Falhou — limpa tudo
        localStorage.removeItem(STORAGE_ACCESS)
        localStorage.removeItem(STORAGE_REFRESH)
        setAxiosToken(null)
        setState({ user: null, accessToken: null, isAuthenticated: false, isLoading: false })
        return
      }

      setState({ user, accessToken: savedToken, isAuthenticated: true, isLoading: false })
    }

    init()
  }, [fetchMe, setAxiosToken, tryRefresh])

  // Interceptor para renovar token automaticamente em 401
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      res => res,
      async error => {
        const original = error.config
        if (error.response?.status === 401 && !original._retry) {
          original._retry = true
          const newToken = await tryRefresh()
          if (newToken) {
            localStorage.setItem(STORAGE_ACCESS, newToken)
            setAxiosToken(newToken)
            original.headers['Authorization'] = `Bearer ${newToken}`
            return axios(original)
          }
          // Refresh falhou — desloga
          logout()
        }
        return Promise.reject(error)
      }
    )
    return () => axios.interceptors.response.eject(interceptor)
  }, [tryRefresh, setAxiosToken])

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const res = await axios.post(`${API_BASE}/auth/login`, { username, password })
    const data = res.data

    if (data.requires_2fa) {
      return { requires2FA: true, preAuthToken: data.pre_auth_token }
    }

    const { access_token, refresh_token } = data
    localStorage.setItem(STORAGE_ACCESS, access_token)
    localStorage.setItem(STORAGE_REFRESH, refresh_token)
    setAxiosToken(access_token)

    const user = await fetchMe(access_token)
    setState({ user, accessToken: access_token, isAuthenticated: true, isLoading: false })
    return { requires2FA: false }
  }, [fetchMe, setAxiosToken])

  const verify2FA = useCallback(async (preAuthToken: string, code: string) => {
    const res = await axios.post(`${API_BASE}/auth/2fa/verify`, {
      pre_auth_token: preAuthToken,
      code,
    })
    const { access_token, refresh_token } = res.data
    localStorage.setItem(STORAGE_ACCESS, access_token)
    localStorage.setItem(STORAGE_REFRESH, refresh_token)
    setAxiosToken(access_token)

    const user = await fetchMe(access_token)
    setState({ user, accessToken: access_token, isAuthenticated: true, isLoading: false })
  }, [fetchMe, setAxiosToken])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_ACCESS)
    localStorage.removeItem(STORAGE_REFRESH)
    setAxiosToken(null)
    setState({ user: null, accessToken: null, isAuthenticated: false, isLoading: false })
  }, [setAxiosToken])

  const refreshUser = useCallback(async () => {
    if (!state.accessToken) return
    const user = await fetchMe(state.accessToken)
    if (user) setState(s => ({ ...s, user }))
  }, [state.accessToken, fetchMe])

  return (
    <AuthContext.Provider value={{ ...state, login, verify2FA, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}
