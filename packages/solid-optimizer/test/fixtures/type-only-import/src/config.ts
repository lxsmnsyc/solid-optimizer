// A build-time module. Its import does not resolve in the app's build.
import 'this-package-does-not-exist';

export interface Config {
  title: string;
}
