import { useState } from 'react'
import { api } from '@/api/client'

export function useTeamOwnPassword() {
  const [changingOwnPassword, setChangingOwnPassword] = useState(false)
  const [ownPasswordSuccess, setOwnPasswordSuccess] = useState('')
  const [ownPasswordError, setOwnPasswordError] = useState('')
  const [ownPasswordForm, setOwnPasswordForm] = useState({ current_password: '', new_password: '' })

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setChangingOwnPassword(true)
    setOwnPasswordError('')
    setOwnPasswordSuccess('')
    try {
      await api.changeMyPassword(ownPasswordForm)
      setOwnPasswordSuccess('Пароль успешно обновлен')
      setOwnPasswordForm({ current_password: '', new_password: '' })
    } catch (err: any) {
      setOwnPasswordError(err?.response?.data?.detail ?? 'Не удалось изменить пароль')
    } finally {
      setChangingOwnPassword(false)
    }
  }

  return {
    changingOwnPassword,
    ownPasswordSuccess,
    ownPasswordError,
    ownPasswordForm,
    setOwnPasswordForm,
    handleChangeOwnPassword,
  }
}
