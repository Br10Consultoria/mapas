import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../contexts/AuthContext'

const API_BASE = '/api/v1'

export default function TwoFASetupPage() {
  const { user, refreshUser } = useAuth()
  const [step, setStep] = useState<'init' | 'scan' | 'confirm' | 'backup' | 'disable'>('init')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const initSetup = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await axios.post(`${API_BASE}/auth/2fa/setup/init`)
      setQrCode(res.data.qr_code)
      setSecret(res.data.secret)
      setStep('scan')
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Erro ao iniciar setup.')
    } finally {
      setLoading(false)
    }
  }

  const confirmSetup = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await axios.post(`${API_BASE}/auth/2fa/setup/confirm`, { code })
      setBackupCodes(res.data.backup_codes)
      setStep('backup')
      await refreshUser()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Código inválido.')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  const disable2FA = async () => {
    setLoading(true)
    setError('')
    try {
      await axios.post(`${API_BASE}/auth/2fa/disable`, { code })
      setStep('init')
      setCode('')
      await refreshUser()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Código inválido.')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Autenticação em Dois Fatores</h1>
      <p className="text-gray-500 text-sm mb-8">
        Proteja sua conta com um código TOTP gerado pelo Google Authenticator, Authy ou similar.
      </p>

      {/* Status atual */}
      <div className={`flex items-center gap-3 p-4 rounded-xl mb-6 ${user?.totp_enabled ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
        <div className={`w-3 h-3 rounded-full ${user?.totp_enabled ? 'bg-green-500' : 'bg-yellow-500'}`} />
        <span className={`text-sm font-medium ${user?.totp_enabled ? 'text-green-700' : 'text-yellow-700'}`}>
          {user?.totp_enabled ? '2FA habilitado na sua conta' : '2FA não habilitado'}
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Passo 1: Início */}
      {step === 'init' && !user?.totp_enabled && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-2">Habilitar 2FA</h2>
          <p className="text-sm text-gray-500 mb-4">
            Você precisará de um aplicativo autenticador instalado no seu celular.
          </p>
          <ul className="text-sm text-gray-600 space-y-1 mb-6">
            <li>• Google Authenticator (Android / iOS)</li>
            <li>• Authy (Android / iOS / Desktop)</li>
            <li>• Microsoft Authenticator</li>
          </ul>
          <button
            onClick={initSetup}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Gerando QR Code...' : 'Iniciar configuração'}
          </button>
        </div>
      )}

      {/* Passo 2: Escanear QR */}
      {step === 'scan' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">Escaneie o QR Code</h2>
          <p className="text-sm text-gray-500">
            Abra seu app autenticador e escaneie o código abaixo.
          </p>
          {qrCode && (
            <div className="flex justify-center">
              <img src={qrCode} alt="QR Code 2FA" className="w-48 h-48 border border-gray-200 rounded-lg" />
            </div>
          )}
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Ou insira o código manualmente:</p>
            <code className="text-xs font-mono text-gray-800 break-all">{secret}</code>
          </div>
          <button
            onClick={() => setStep('confirm')}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm"
          >
            Já escaniei → Confirmar código
          </button>
        </div>
      )}

      {/* Passo 3: Confirmar código */}
      {step === 'confirm' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">Confirmar código</h2>
          <p className="text-sm text-gray-500">
            Insira o código de 6 dígitos gerado pelo seu app para confirmar a configuração.
          </p>
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
            autoFocus
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="000000"
          />
          <button
            onClick={confirmSetup}
            disabled={loading || code.length !== 6}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium py-2.5 rounded-lg text-sm"
          >
            {loading ? 'Verificando...' : 'Habilitar 2FA'}
          </button>
          <button onClick={() => setStep('scan')} className="w-full text-gray-500 text-sm py-1">
            ← Voltar
          </button>
        </div>
      )}

      {/* Passo 4: Códigos de backup */}
      {step === 'backup' && (
        <div className="bg-white rounded-xl border border-green-200 p-6 space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <h2 className="font-semibold">2FA habilitado com sucesso!</h2>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm font-medium text-yellow-800 mb-3">
              ⚠️ Guarde estes códigos de backup em local seguro. Cada código pode ser usado uma vez se você perder acesso ao app.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((c, i) => (
                <code key={i} className="bg-white border border-yellow-300 rounded px-3 py-1.5 text-sm font-mono text-center">
                  {c}
                </code>
              ))}
            </div>
          </div>
          <button
            onClick={() => setStep('init')}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm"
          >
            Concluir
          </button>
        </div>
      )}

      {/* Desabilitar 2FA */}
      {user?.totp_enabled && step === 'init' && (
        <div className="bg-white rounded-xl border border-red-200 p-6 mt-4">
          <h2 className="font-semibold text-red-700 mb-2">Desabilitar 2FA</h2>
          <p className="text-sm text-gray-500 mb-4">
            Insira o código atual do seu app para desabilitar a autenticação em dois fatores.
          </p>
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"
            placeholder="000000"
          />
          <button
            onClick={disable2FA}
            disabled={loading || code.length !== 6}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium py-2.5 rounded-lg text-sm"
          >
            {loading ? 'Desabilitando...' : 'Desabilitar 2FA'}
          </button>
        </div>
      )}
    </div>
  )
}
