export const REQUIRED_VIEWPORTS: readonly [
  'desktop-1440x900',
  'laptop-1024x768',
  'tablet-768x1024',
  'mobile-390x844',
];

export interface ValidatedQualityReport {
  readonly head: string;
  readonly browserVersion: string;
  readonly screenshots: readonly {
    readonly name: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly path: string;
    readonly bytes: number;
  }[];
  readonly performance: {
    readonly metrics: Readonly<Record<string, number>>;
    readonly budgets: Readonly<Record<string, number>>;
  };
  readonly accessibility: {
    readonly keyboardUniqueControls: number;
    readonly visibleFocusStops: number;
    readonly navCount: number;
  };
  readonly paperFlow: {
    readonly filled: boolean;
    readonly positionVisibleBeforeReload: boolean;
    readonly positionVisibleAfterReload: boolean;
  };
  readonly offlineRecovery: {
    readonly serviceWorkerControlled: boolean;
    readonly offlineShellRendered: boolean;
    readonly recoveryNoticeRendered: boolean;
  };
}

export function validateQualityReport(report: unknown, expectedHead: string): ValidatedQualityReport;
export function walkFiles(root: string): Promise<string[]>;
export function sha256File(file: string): Promise<string>;
export function checksumLines(root: string, excluded?: ReadonlySet<string>): Promise<string[]>;
