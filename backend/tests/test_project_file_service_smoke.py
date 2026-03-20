from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException

from app.services.project_file_service import (
    build_project_file_download_response,
    build_project_file_import_precheck,
    delete_project_file_with_audit,
    get_project_file_download_response,
    get_project_file_import_precheck_by_id,
    read_project_file_payload_or_http,
    start_ai_processing_job_for_file,
    upload_project_file_with_ai,
)


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


class _FakeDB:
    def __init__(self, execute_values):
        self._execute_values = list(execute_values)
        self.added = []
        self.deleted = []
        self.commit_calls = 0
        self.refreshed = []

    def add(self, value):
        if getattr(value, "id", None) is None and value.__class__.__name__ == "AIIngestionJob":
            value.id = "job-1"
        self.added.append(value)

    async def execute(self, _query):
        if not self._execute_values:
            raise AssertionError("No fake DB results left")
        return _ScalarResult(self._execute_values.pop(0))

    async def commit(self):
        self.commit_calls += 1

    async def refresh(self, value):
        self.refreshed.append(value)

    async def delete(self, value):
        self.deleted.append(value)


class _FakeUpload:
    def __init__(self, filename: str | None, content_type: str | None, payload: bytes):
        self.filename = filename
        self.content_type = content_type
        self._payload = payload

    async def read(self):
        return self._payload


class ProjectFileServiceSmokeTest(unittest.TestCase):
    def test_read_payload_maps_errors(self):
        record = SimpleNamespace(id="f-1", storage_path="/tmp/x")
        with patch(
            "app.services.project_file_service._read_project_file_bytes",
            side_effect=FileNotFoundError,
        ):
            with self.assertRaises(HTTPException):
                read_project_file_payload_or_http(record)
        with patch(
            "app.services.project_file_service._read_project_file_bytes",
            side_effect=RuntimeError("boom"),
        ):
            with self.assertRaises(HTTPException):
                read_project_file_payload_or_http(record)

    def test_build_download_and_precheck_helpers(self):
        record = SimpleNamespace(filename="plan.mpp", content_type="application/octet-stream")
        response = build_project_file_download_response(record, b"abc")
        self.assertIn("attachment; filename=", response.headers.get("content-disposition", ""))
        with (
            patch(
                "app.services.project_file_service.read_project_file_payload_or_http",
                return_value=b"abc",
            ),
            patch(
                "app.services.project_file_service.inspect_import_file",
                return_value=SimpleNamespace(
                    file_type="mpp",
                    detected_headers=["Task Name"],
                    recognized_columns=["Task Name"],
                    missing_columns=[],
                    warnings=[],
                    can_start_ai=True,
                ),
            ),
        ):
            precheck = build_project_file_import_precheck(record)
        self.assertEqual(precheck["file_type"], "mpp")

    def test_download_and_precheck_by_file_id(self):
        async def _run():
            record = SimpleNamespace(id="f-1", filename="plan.mpp", content_type="application/octet-stream")
            with (
                patch(
                    "app.services.project_file_service.get_project_file_or_404",
                    new=AsyncMock(return_value=record),
                ),
                patch(
                    "app.services.project_file_service.read_project_file_payload_or_http",
                    return_value=b"abc",
                ),
                patch(
                    "app.services.project_file_service.build_project_file_import_precheck",
                    return_value={"file_type": "mpp"},
                ),
            ):
                response = await get_project_file_download_response(
                    SimpleNamespace(),
                    project_id="p-1",
                    file_id="f-1",
                )
                precheck = await get_project_file_import_precheck_by_id(
                    SimpleNamespace(),
                    project_id="p-1",
                    file_id="f-1",
                )
                return response, precheck

        response, precheck = asyncio.run(_run())
        self.assertIn("attachment; filename=", response.headers.get("content-disposition", ""))
        self.assertEqual(precheck["file_type"], "mpp")

    def test_upload_project_file_with_ai_happy_path(self):
        async def _run():
            db = _FakeDB([SimpleNamespace(id="f-1", filename="plan.mpp")])
            actor = SimpleNamespace(id="u-1")
            upload = _FakeUpload("plan.mpp", "application/octet-stream", b"payload")
            with (
                patch(
                    "app.services.project_file_service._store_project_file_encrypted",
                    return_value=("/tmp/file", "nonce-1", 9),
                ),
                patch("app.services.project_file_service.uuid.uuid4", return_value="f-1"),
                patch("app.services.project_file_service.log_system_activity", new=AsyncMock()),
                patch(
                    "app.services.project_file_service._queue_ai_ingestion_job",
                    new=Mock(),
                ) as queue_mock,
            ):
                file_out = await upload_project_file_with_ai(
                    db,
                    project_id="p-1",
                    upload=upload,
                    actor=actor,
                )
                return file_out, db.commit_calls, queue_mock.call_count

        file_out, commit_calls, queue_calls = asyncio.run(_run())
        self.assertEqual(file_out.id, "f-1")
        self.assertEqual(commit_calls, 2)
        self.assertEqual(queue_calls, 1)

    def test_start_ai_and_delete_file(self):
        async def _run():
            db = _FakeDB([])
            with (
                patch(
                    "app.services.project_file_service.get_project_file_or_404",
                    new=AsyncMock(return_value=SimpleNamespace(id="f-1", filename="plan.mpp")),
                ),
                patch("app.services.project_file_service.log_system_activity", new=AsyncMock()),
                patch("app.services.project_file_service._delete_project_file_blob"),
                patch(
                    "app.services.project_file_service._queue_ai_ingestion_job",
                    new=Mock(),
                ) as queue_mock,
            ):
                job = await start_ai_processing_job_for_file(
                    db,
                    project_id="p-1",
                    file_id="f-1",
                    actor_id="u-1",
                    prompt_instruction="  go  ",
                )
                await delete_project_file_with_audit(
                    db,
                    project_id="p-1",
                    file_id="f-1",
                    actor_id="u-1",
                )
                return job, db.commit_calls, len(db.refreshed), len(db.deleted), queue_mock.call_count

        job, commit_calls, refreshed, deleted, queue_calls = asyncio.run(_run())
        self.assertEqual(job.id, "job-1")
        self.assertEqual(commit_calls, 2)
        self.assertEqual(refreshed, 1)
        self.assertEqual(deleted, 1)
        self.assertEqual(queue_calls, 1)


if __name__ == "__main__":
    unittest.main()
