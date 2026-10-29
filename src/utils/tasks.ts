/** 通信と画像デコードの同時実行数を、呼び出し元全体で制限する。 */
export function createLimiter(concurrency: number) {
    let activeCount = 0;
    const waitingTasks: (() => void)[] = [];

    return async function run<T>(task: () => Promise<T>): Promise<T> {
        if (activeCount >= concurrency) {
            await new Promise<void>(resolve => waitingTasks.push(resolve));
        } else {
            activeCount++;
        }

        try {
            return await task();
        } finally {
            const startNextTask = waitingTasks.shift();
            if (startNextTask) {
                // 実行枠を次のタスクへ引き継ぐため、実行数は減らさない。
                startNextTask();
            } else {
                activeCount--;
            }
        }
    };
}
