import unittest
import sys
import types


if "httpx" not in sys.modules:
    sys.modules["httpx"] = types.ModuleType("httpx")
if "pypdf" not in sys.modules:
    fake_pypdf = types.ModuleType("pypdf")
    fake_pypdf.PdfReader = object  # type: ignore[attr-defined]
    sys.modules["pypdf"] = fake_pypdf
if "app.core.config" not in sys.modules:
    fake_cfg = types.ModuleType("app.core.config")
    fake_cfg.settings = types.SimpleNamespace(
        AI_MAX_DRAFTS=2000,
        DEEPSEEK_API_KEY="",
        DEEPSEEK_BASE_URL="https://api.deepseek.com",
        DEEPSEEK_MODEL="deepseek-chat",
        OPENROUTER_API_KEY="",
        OPENROUTER_BASE_URL="https://openrouter.ai/api/v1",
        OPENROUTER_MODEL="deepseek/deepseek-chat",
    )
    sys.modules["app.core.config"] = fake_cfg

from app.services.ai_ingestion_service import _extract_tasks_from_ppo_quarter_plan


SAMPLE_PPO_TEXT = """
ПЛАН МЕРОПРИЯТИЙ
по доработке информационного обеспечения системы планирования
на 2-й квартал 2026г.

В ДОС, не относить дефицит комплектующих
Обеспечить покрытие дефицита для набора при списании набора признаком 51
1
ЦК ИНФОР,
ОРИТ,
ОАСУП

По письмам ППО, установление причин и сроков устранения недочетов
3
ОАСУП,
ОРИТ,
ЦК ИНФОР

8.
Разработать функционал авансирования
3
ОРИТ

36.
Доработать построение графиков обеспечения ТМЦ
0
ОАСУП

Начальник ОАСУП
Иванов И.И.
"""

SAMPLE_PPO_TABLE_TEXT = """
ПЛАН МЕРОПРИЯТИЙ
по доработке информационного обеспечения системы планирования
на 2-й квартал 2026г.
|№  |мероприятие                                                            |при|исполн|
|п/п|                                                                       |ори|итель |
|   |В ДОС, не относить дефицит комплектующих                               |1  |ЦК    |
|   |при списании набора признаком 51                                       |   |ИНФОР,|
|   |                                                                       |   |ОАСУП |
|   |По письмам ППО, установление причин и сроков устранения недочетов      |3  |ОАСУП,|
|   |функционала ИСУ АСУП                                                    |   |ОРИТ  |
|8. |Разработать функционал авансирования                                    |3  |ОРИТ  |
|36.|Доработать построение графиков обеспечения ТМЦ                          |0  |ОАСУП |
Руководитель                                                              ЦК
"""


class PPOQuarterPlanParserTests(unittest.TestCase):
    def test_parses_description_priority_assignee_blocks(self):
        tasks = _extract_tasks_from_ppo_quarter_plan(SAMPLE_PPO_TEXT)
        self.assertEqual(len(tasks), 4)

        first = tasks[0]
        self.assertIsNone(first["raw_payload"]["task_no"])
        self.assertEqual(first["priority"], "critical")
        self.assertEqual(first["raw_payload"]["priority_raw"], "1")
        self.assertEqual(first["raw_payload"]["parser"], "ppo_quarter_plan")
        self.assertIn("ЦК ИНФОР", first["raw_payload"]["assignee_hint"])
        self.assertIn("ОАСУП", first["raw_payload"]["assignee_hint"])

        last = tasks[-1]
        self.assertEqual(last["raw_payload"]["task_no"], "36")
        self.assertEqual(last["priority"], "low")

    def test_footer_signature_is_not_parsed_as_task(self):
        tasks = _extract_tasks_from_ppo_quarter_plan(SAMPLE_PPO_TEXT)
        titles = " ".join(item["title"] for item in tasks)
        self.assertNotIn("начальник", titles.lower())
        self.assertNotIn("иванов", titles.lower())

    def test_parses_pipe_table_legacy_doc_shape(self):
        tasks = _extract_tasks_from_ppo_quarter_plan(SAMPLE_PPO_TABLE_TEXT)
        self.assertEqual(len(tasks), 4)
        self.assertEqual(tasks[0]["priority"], "critical")
        self.assertEqual(tasks[0]["raw_payload"]["task_no"], None)
        self.assertIn("ЦК ИНФОР", tasks[0]["raw_payload"]["assignee_hint"])
        self.assertEqual(tasks[2]["raw_payload"]["task_no"], "8")
        self.assertEqual(tasks[3]["priority"], "low")


if __name__ == "__main__":
    unittest.main()
