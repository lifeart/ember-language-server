import EmberRouter from '@ember/routing/router';
import config from './config/environment';

const Router = EmberRouter.extend({
  location: config.locationType,
  rootURL: config.rootURL
});

Router.map(function() {
  this.route('test-route', function() {
    this.route('nested-route');
  });
  this.route('post', { path: '/post/:post_id' }, function() {
    this.route('edit');
    this.route('comments', { resetNamespace: true }, function() {
      this.route('new');
    });
  });
});

export default Router;
