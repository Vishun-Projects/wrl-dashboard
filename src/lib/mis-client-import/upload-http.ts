import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { processClientMisUpload } from '@/lib/mis-client-import/process-upload';
import {
  formatMisUploadTooLargeMessage,
  MIS_CLIENT_MAX_UPLOAD_BYTES,
} from '@/lib/mis-client-import/upload-limits';
import { canUploadClientMis } from '@/lib/mis-client-import/upload-access';

export type MisUploadHttpResult = {
  status: number;
  body: Record<string, unknown>;
};

export async function handleMisClientUploadFormData(params: {
  userId: string;
  formData: FormData;
}): Promise<MisUploadHttpResult> {
  const userAuth = await queryUserAuth(params.userId);
  const email = userAuth?.profile?.email;
  if (!canUploadClientMis(email)) {
    return { status: 403, body: { error: 'Forbidden' } };
  }

  const sourceCode = String(params.formData.get('sourceCode') ?? '').trim().toLowerCase();
  const file = params.formData.get('file');

  if (!sourceCode) {
    return { status: 400, body: { error: 'sourceCode is required' } };
  }
  if (!(file instanceof File) && !(file && typeof file === 'object' && 'arrayBuffer' in file)) {
    return { status: 400, body: { error: 'file is required' } };
  }

  const uploadFile = file as File;
  if (uploadFile.size > MIS_CLIENT_MAX_UPLOAD_BYTES) {
    return {
      status: 400,
      body: { error: formatMisUploadTooLargeMessage(uploadFile.size) },
    };
  }

  const buffer = Buffer.from(await uploadFile.arrayBuffer());
  const result = await processClientMisUpload({
    sourceCode,
    fileName: uploadFile.name,
    buffer,
    uploadedBy: params.userId,
  });

  if (!result.batchId) {
    return {
      status: 422,
      body: {
        error: 'Import failed — no valid rows',
        errorCount: result.errorCount,
        errors: result.errors,
        warnings: result.warnings,
      },
    };
  }

  return {
    status: 200,
    body: {
      batchId: result.batchId,
      rowCount: result.rowCount,
      errorCount: result.errorCount,
      errors: result.errors,
      warnings: result.warnings,
      filterStart: result.filterStart,
      filterEnd: result.filterEnd,
    },
  };
}
