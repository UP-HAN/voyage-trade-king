import { mergeConfig, type Plugin, type UserConfig } from 'vite';
import base from '../../vite.config';

/**
 * 작업 107 확인용 빌드 설정: 루트 vite.config.ts 그대로 + 교사 라우트(src/teacher, 작업 109 진행 중)를 빈 화면으로 바꿔 묶는다.
 * 다른 작업이 진행 중인 파일 때문에 학생 화면 확인이 막히지 않게 하려는 것뿐이다(정식 빌드는 `npm run build`).
 */
const stubTeacher: Plugin = {
  name: 'voyage:stub-teacher-107',
  enforce: 'pre',
  resolveId(id, importer) {
    if (id === './teacher/index' && importer && importer.replace(/\\/g, '/').endsWith('/src/main.tsx')) return '\0teacher-stub';
    return null;
  },
  load(id) {
    if (id === '\0teacher-stub') return 'export default function TeacherStub() { return null; }';
    return null;
  },
};

export default mergeConfig(base as UserConfig, { plugins: [stubTeacher] });
