import { useEffect } from 'react'
import { BookOpen, Download, FolderKanban, ShieldCheck, Smartphone, Upload, Users, Workflow, BrainCircuit, Mail, ListChecks, Lock, Zap } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

type HelpSection = {
  id: string
  title: string
  icon: typeof FolderKanban
  summary: string
  bullets: string[]
  downloadLink?: { href: string; label: string }
}

const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'projects',
    title: 'Проекты и задачи',
    icon: FolderKanban,
    summary: 'Как строить проект, раскладывать задачи и не смешивать структуру с порядком выполнения.',
    bullets: [
      'Проект объединяет сроки, участников, документы и общий прогресс.',
      'Связь родитель-дочерняя отвечает только за структуру и визуальную вложенность.',
      'Зависимость отвечает только за порядок выполнения и блокировку старта.',
      'В строгом режиме проект может запрещать даты в прошлом и нарушения по зависимостям.',
    ],
  },
  {
    id: 'planning-modes',
    title: 'Гибкий и строгий режимы',
    icon: FolderKanban,
    summary: 'Когда оставлять свободу, а когда включать управленческую дисциплину проекта.',
    bullets: [
      'Гибкий режим подходит для быстрых рабочих списков, где важнее не мешать команде лишними ограничениями.',
      'Строгий режим нужен там, где сроки и порядок работ должны контролироваться системой, а не вручную.',
      'В строгом режиме можно запретить даты в прошлом и выход дочерних задач за диапазон родителя.',
      'Если проект живёт как личный рабочий список отдела, чаще подходит гибкий режим; если как формальный план, чаще строгий.',
    ],
  },
  {
    id: 'dependencies',
    title: 'Структура и зависимости',
    icon: Workflow,
    summary: 'Коротко и по делу: когда использовать родительскую связь, а когда зависимость.',
    bullets: [
      'Если нужно показать, что задача является частью этапа, используйте родительскую связь.',
      'Если нужно запретить старт задачи до выполнения другой, используйте зависимость.',
      'FS: следующая стартует после завершения предыдущей.',
      'SS / FF: задачи могут идти параллельно, но стартуют или завершаются синхронно.',
    ],
  },
  {
    id: 'bulk-edit',
    title: 'Массовое редактирование',
    icon: ListChecks,
    summary: 'Выберите несколько задач и применяйте операции одним кликом — статус, исполнитель, приоритет, дедлайн, перенос проекта.',
    bullets: [
      'Выделите задачи чекбоксами в списке проекта — появится панель массовых действий.',
      'Доступны операции: изменить статус, назначить/снять исполнителя, изменить приоритет, удалить (при наличии прав).',
      'Сдвиг дедлайна — укажите количество дней (положительное или отрицательное) и обязательную причину. Каждый сдвиг фиксируется в истории изменений дедлайна.',
      'Перенос в другой проект — задачи переезжают целиком; подзадачи с «чужим» родителем автоматически открепляются. Требуется роль менеджера в целевом проекте.',
    ],
  },
  {
    id: 'ai-manager',
    title: 'AI Project Manager',
    icon: BrainCircuit,
    summary: 'Встроенный ИИ-аналитик на базе DeepSeek анализирует проект и выдаёт конкретные рекомендации.',
    bullets: [
      'Кнопка «AI Анализ» в шапке проекта — запускает анализ прямо сейчас. Результат появляется в модальном окне.',
      'Анализ включает 4 блока: общая оценка состояния, топ рисков с конкретными задачами, баланс нагрузки по людям, рекомендации с приоритетами 🔴🟡🟢.',
      'Ночной скан (ежедневно в 08:00 UTC) — механически проверяет все активные проекты и шлёт Telegram-алерт только если есть реальные проблемы.',
      'Еженедельный дайджест (каждый понедельник) — вызывает ИИ по каждому проекту и отправляет аналитику в Telegram.',
    ],
  },
  {
    id: 'roles',
    title: 'Роли, права и видимость',
    icon: Users,
    summary: 'Кто что видит, кто кого может назначать и почему у разных людей интерфейс отличается.',
    bullets: [
      'Права загружаются при входе и кэшируются на 5 минут — скрытые кнопки и разделы подстраиваются автоматически.',
      'Администратор видит всю систему и может назначать любых активных пользователей.',
      'Руководители обычно работают в режиме видимости отдела и могут вести проекты шире одного отдела по политике назначения.',
      'Исполнители могут работать в режиме только своих задач и видеть только свои задачи и связанные проекты.',
      'Все отказы в доступе фиксируются в журнале системной активности для аудита.',
    ],
  },
  {
    id: 'assignment-policy',
    title: 'Политика назначений',
    icon: Users,
    summary: 'Короткая шпаргалка: кого можно назначать на проект и задачу в зависимости от роли.',
    bullets: [
      'Администратор может назначать любого активного пользователя на проект и задачу.',
      'ГИП / ЗАМ могут привлекать людей из любых отделов, даже если у них нет своей команды.',
      'Руководитель отдела может назначать сотрудников своего и смежных отделов по политике доступа.',
      'Исполнитель обычно видит только свои задачи, если для него включён режим только своих задач.',
    ],
  },
  {
    id: 'signals',
    title: 'Контроль и сигналы',
    icon: ShieldCheck,
    summary: 'Как читать блоки контроля, СКИ и статусы активности команды.',
    bullets: [
      'Сигналы контроля показывают новые, обновлённые, завершённые и зависшие задачи за последние 7 дней.',
      'СКИ-контроль выделяет задачи, которые требуют повышенного внимания.',
      'В команде статус входа помогает быстро понять, кто активен, кто давно не заходил и кто не входил ни разу.',
      'Если цифры кажутся странными, сначала проверьте фильтры, затем обновите страницу.',
    ],
  },
  {
    id: 'email-digests',
    title: 'Email-дайджесты и уведомления',
    icon: Mail,
    summary: 'Ролевые HTML-письма с кнопками быстрых действий прямо из почты.',
    bullets: [
      'Каждый получатель видит только своё: директор — полный срез, руководитель — свой отдел, исполнитель — свои задачи.',
      'В письмах есть кнопки быстрых действий: «Открыть задачу», «Взять в работу», «Check-in», «Эскалировать» — ссылки подписаны JWT-токеном, действуют 7 дней.',
      'Тест-режим (включается в настройках команды) перенаправляет все письма на один адрес — безопасно репетировать рассылки без спама команде.',
      'В разделе «Команда → Настройки отчётности» видна статистика доставки по каждому источнику: sent / failed / skipped и error-rate.',
    ],
  },
  {
    id: 'vault',
    title: 'Защищённое хранилище',
    icon: Lock,
    summary: 'Файлы команды зашифрованы AES-256-GCM — ключ для каждого файла свой.',
    bullets: [
      'Загрузить файл может любой участник команды, удалить — только пользователи с правом delete_vault_files.',
      'Файлы организованы по папкам: Отчёты, Презентации, Договоры, Прочее — или без папки.',
      'Скачивание работает через короткоживущий (15 мин) подписанный URL — браузер открывает файл напрямую без Bearer-токена.',
      'Каждый файл шифруется своим ключом на основе HKDF-SHA256 — компрометация одного файла не затрагивает остальные.',
    ],
  },
  {
    id: 'import',
    title: 'Импорт и распознавание исполнителей',
    icon: Upload,
    summary: 'Как готовить XML / XLSX, чтобы задачи и исполнители распознавались без ручной чистки.',
    bullets: [
      'Для MS Project предпочтителен XML/MSPDI, а не только исходный MPP.',
      'Для XLSX лучше использовать шаблон ниже — колонки уже названы правильно, даты в текстовом формате ДД.ММ.ГГГГ.',
      'Исполнители лучше всего матчятся по email или по формату Фамилия И.О.',
      'Если человека ещё нет в системе, имя может попасть во временные назначения для дальнейшей привязки.',
    ],
    downloadLink: { href: '/task_import_template.xlsx', label: 'Скачать шаблон XLSX' },
  },
  {
    id: 'mobile',
    title: 'Мобильное приложение',
    icon: Smartphone,
    summary: 'Когда удобнее работать с телефона и чего ждать от мобильного контура PlannerBro.',
    bullets: [
      'Мобильное приложение подходит для быстрого входа, просмотра задач, статусов и уведомлений вне рабочего места.',
      'Авторизация использует тот же backend и те же access/refresh token-механизмы, что и веб-версия.',
      'Мобильный Gantt и обзорные экраны упрощены по сравнению с вебом: идея в скорости, а не в попытке запихнуть весь офис в экран телефона.',
      'Если в мобильном приложении что-то выглядит не так, как в вебе, это чаще всего осознанное упрощение, а не баг-переодевание.',
    ],
  },
]

const QUICK_LINKS = [
  { label: 'Проекты и задачи', href: '#projects' },
  { label: 'Режимы планирования', href: '#planning-modes' },
  { label: 'Структура и зависимости', href: '#dependencies' },
  { label: 'Массовое редактирование', href: '#bulk-edit' },
  { label: 'AI Project Manager', href: '#ai-manager' },
  { label: 'Роли и видимость', href: '#roles' },
  { label: 'Политика назначений', href: '#assignment-policy' },
  { label: 'Сигналы контроля', href: '#signals' },
  { label: 'Email-дайджесты', href: '#email-digests' },
  { label: 'Защищённое хранилище', href: '#vault' },
  { label: 'Импорт файлов', href: '#import' },
  { label: 'Мобильное приложение', href: '#mobile' },
]

export function Help() {
  const location = useLocation()

  useEffect(() => {
    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const id = location.hash.replace('#', '')
    const target = document.getElementById(id)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [location.hash])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <section className="rounded-2xl border bg-card p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Справка</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Справка по PlannerBro</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Встроенный центр знаний по проектам, задачам, зависимостям, ролям, видимости, импорту и новым AI-возможностям.
            </p>
          </div>
          <div className="rounded-2xl border bg-muted/30 p-4 lg:w-[320px]">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Быстрые переходы</p>
            <div className="mt-3 flex flex-col gap-2">
              {QUICK_LINKS.map((item) => (
                <a key={item.href} href={item.href} className="rounded-xl border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent">
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {HELP_SECTIONS.map((section) => {
          const Icon = section.icon
          return (
            <article id={section.id} key={section.id} className="scroll-mt-24 rounded-2xl border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{section.title}</h2>
                  <p className="text-xs text-muted-foreground">{section.summary}</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {section.bullets.map((point) => (
                  <p key={point} className="rounded-xl bg-muted/40 px-3 py-2 text-sm leading-6 text-muted-foreground">{point}</p>
                ))}
                {section.downloadLink && (
                  <a
                    href={section.downloadLink.href}
                    download
                    className="inline-flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent"
                  >
                    <Download className="h-4 w-4" />
                    {section.downloadLink.label}
                  </a>
                )}
              </div>
            </article>
          )
        })}
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Связанные материалы</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/team" className="rounded-xl border px-3 py-2 text-sm transition-colors hover:bg-accent">Открыть Команду</Link>
            <Link to="/" className="rounded-xl border px-3 py-2 text-sm transition-colors hover:bg-accent">Вернуться в Проекты</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
