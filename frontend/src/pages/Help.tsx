import { useEffect } from 'react'
import { BookOpen, FolderKanban, ShieldCheck, Upload, Users, Workflow } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

type HelpSection = {
  id: string
  title: string
  icon: typeof FolderKanban
  summary: string
  bullets: string[]
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
    id: 'roles',
    title: 'Роли, права и видимость',
    icon: Users,
    summary: 'Кто что видит, кто кого может назначать и почему у разных людей интерфейс отличается.',
    bullets: [
      'Администратор видит всю систему и может назначать любых активных пользователей.',
      'Руководители обычно работают в режиме видимости отдела и могут вести проекты шире одного отдела по политике назначения.',
      'Исполнители могут работать в режиме только своих задач и видеть только свои задачи и связанные проекты.',
      'ГИП / ЗАМ и руководители отделов работают по расширенным правилам назначения.',
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
    id: 'import',
    title: 'Импорт и распознавание исполнителей',
    icon: Upload,
    summary: 'Как готовить XML / XLSX, чтобы задачи и исполнители распознавались без ручной чистки.',
    bullets: [
      'Для MS Project предпочтителен XML/MSPDI, а не только исходный MPP.',
      'Для XLSX лучше использовать явные колонки: Наименование, Срок, Исполнитель, Заказчик, Вид задачи.',
      'Исполнители лучше всего матчятся по email или по формату Фамилия И.О.',
      'Если человека ещё нет в системе, имя может попасть во временные назначения для дальнейшей привязки.',
    ],
  },
]

const QUICK_LINKS = [
  { label: 'Проекты и задачи', href: '#projects' },
  { label: 'Режимы планирования', href: '#planning-modes' },
  { label: 'Структура и зависимости', href: '#dependencies' },
  { label: 'Роли и видимость', href: '#roles' },
  { label: 'Политика назначений', href: '#assignment-policy' },
  { label: 'Сигналы контроля', href: '#signals' },
  { label: 'Импорт файлов', href: '#import' },
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
              Встроенный центр знаний по проектам, задачам, зависимостям, ролям, видимости и импорту.
              Это короткая рабочая версия справки внутри системы: без лишней теории, с акцентом на то, что
              реально помогает в ежедневной работе.
            </p>
          </div>

          <div className="rounded-2xl border bg-muted/30 p-4 lg:w-[320px]">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Быстрые переходы</p>
            <div className="mt-3 flex flex-col gap-2">
              {QUICK_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-xl border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent"
                >
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
                  <p key={point} className="rounded-xl bg-muted/40 px-3 py-2 text-sm leading-6 text-muted-foreground">
                    {point}
                  </p>
                ))}
              </div>
            </article>
          )
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BookOpen className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold">Сценарий руководителя</h2>
          </div>
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            <p>1. Создайте проект и определите режим планирования.</p>
            <p>2. Разложите этапы через parent-child.</p>
            <p>3. Проставьте зависимости только там, где реально нужен контроль старта.</p>
            <p>4. Назначьте ответственных и проверьте сигналы контроля.</p>
          </div>
        </article>

        <article className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold">Сценарий исполнителя</h2>
          </div>
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            <p>1. Откройте `Мои задачи`, если для вас включён режим личной видимости.</p>
            <p>2. Обновляйте статус, прогресс и следующий шаг.</p>
            <p>3. Используйте отметки выполнения, если задачу нужно регулярно подтверждать.</p>
            <p>4. Следите за дедлайнами и текстовыми индикаторами срочности.</p>
          </div>
        </article>

        <article className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Upload className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold">Сценарий импорта</h2>
          </div>
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            <p>1. Подготовьте XML/MSPDI или XLSX с явными колонками.</p>
            <p>2. Проверьте, как указаны исполнители: email или `Фамилия И.О.`.</p>
            <p>3. Импортируйте файл в проект и проверьте черновики.</p>
            <p>4. Если нужно, используйте временные назначения для людей, которых ещё нет в системе.</p>
          </div>
        </article>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <h2 className="text-lg font-semibold">Права и назначение без путаницы</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              В PlannerBro роль отвечает не только за права, но и за то, какой объём данных человек видит после входа.
            </p>
          </div>
          <Link
            to="/team"
            className="inline-flex rounded-xl border px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            Открыть настройки команды
          </Link>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-semibold">Как читать `visibility_scope`</p>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p><span className="font-medium text-foreground">Только свои задачи</span> — человек работает прежде всего со своим контуром задач.</p>
              <p><span className="font-medium text-foreground">Контур отдела</span> — видит задачи и проекты в рамках управленческого контура.</p>
              <p><span className="font-medium text-foreground">Полный доступ</span> — полный обзор системы, обычно только для администратора.</p>
            </div>
          </div>

          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-semibold">Как читать переключатели прав</p>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p><span className="font-medium text-foreground">Только свои задачи</span> — включает личный режим «Мои задачи» как основной фильтр.</p>
              <p><span className="font-medium text-foreground">Управление командой</span> — разрешает управление командой и подчинёнными.</p>
              <p><span className="font-medium text-foreground">Импорт / массовые правки / удаление</span> — отдельные рабочие полномочия, которые можно выдавать точечно.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Как выбрать режим проекта</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-semibold">Гибкий режим</p>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>Подходит для личных и оперативных списков задач, где важна скорость, а не жёсткая валидация.</p>
              <p>Хороший вариант для отделов, которые просто ведут рабочий список и не хотят тормозить работу правилами.</p>
            </div>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-semibold">Строгий режим</p>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>Подходит для проектов с формальной дисциплиной: этапы, зависимость старта и контроль дат.</p>
              <p>Лучше использовать там, где нарушение срока или порядка выполнения уже влияет на отчётность или внешний контур.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Пример XLSX для импорта</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Чем чище и понятнее колонки, тем выше шанс, что черновики будут созданы без ручной чистки.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Отдел</th>
                <th className="px-3 py-2 font-medium">Бюро</th>
                <th className="px-3 py-2 font-medium">Наименование</th>
                <th className="px-3 py-2 font-medium">Вид задачи</th>
                <th className="px-3 py-2 font-medium">Срок</th>
                <th className="px-3 py-2 font-medium">Исполнитель</th>
                <th className="px-3 py-2 font-medium">Заказчик</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="px-3 py-2 text-muted-foreground">ОАСУП</td>
                <td className="px-3 py-2 text-muted-foreground">Бюро 1</td>
                <td className="px-3 py-2 text-muted-foreground">Подготовить стат.отчёт 3-информ</td>
                <td className="px-3 py-2 text-muted-foreground">Отчётность</td>
                <td className="px-3 py-2 text-muted-foreground">2026-03-18</td>
                <td className="px-3 py-2 text-muted-foreground">Иванов И.И.</td>
                <td className="px-3 py-2 text-muted-foreground">ПЭО</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
          <p className="rounded-xl border bg-muted/30 px-3 py-2">Лучше использовать дату в явном формате `YYYY-MM-DD`.</p>
          <p className="rounded-xl border bg-muted/30 px-3 py-2">Исполнителя лучше писать как `email` или `Фамилия И.О.`.</p>
          <p className="rounded-xl border bg-muted/30 px-3 py-2">Если исполнителей несколько, их лучше разделять `;`.</p>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Первый вход: короткий маршрут</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-semibold">1. Проверьте свою роль</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Откройте раздел `Команда` и убедитесь, что у вас верные роль, отдел и видимость.
            </p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-semibold">2. Откройте рабочий контур</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Исполнителю обычно нужен `Мои задачи`, руководителю — `Проекты`, админу — `Команда`.
            </p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-semibold">3. Подключите справку по месту</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Если неясно, почему задача заблокирована или кого можно назначить, переходите в справку прямо из формы.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Связанные материалы</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Если нужна более подробная версия, можно продолжить из интерфейса в расширенную документацию проекта.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/team" className="rounded-xl border px-3 py-2 text-sm transition-colors hover:bg-accent">
              Открыть Команду
            </Link>
            <Link to="/" className="rounded-xl border px-3 py-2 text-sm transition-colors hover:bg-accent">
              Вернуться в Проекты
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
